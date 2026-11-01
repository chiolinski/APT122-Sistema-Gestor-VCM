const crypto = require("node:crypto");
const { writeAudit } = require("../lib/audit");
const { deleteBlobIfExists, downloadBlob, uploadBlob } = require("../lib/blobStorage");
const { getConfig } = require("../lib/config");
const { AppError } = require("../lib/http");
const { UUID_PATTERN, assertProjectFileDeletionAllowed, buildStorageKey, validateProjectFile } = require("../lib/projectFiles");
const { sql, getPool, withTransaction } = require("../lib/db");

async function authorizeUpload(publicCode, descriptor, principal) {
  const pool = await getPool();
  const result = await pool.request()
    .input("code", sql.VarChar(30), publicCode)
    .input("sectionId", sql.UniqueIdentifier, descriptor.sectionId)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
    .query(`
      SELECT CONVERT(varchar(36), project.proyecto_id) AS projectId, project.estado AS projectStatus,
        CASE WHEN @sectionId IS NULL OR EXISTS (
          SELECT 1 FROM vcm.ProyectoSeccion projectSection
          WHERE projectSection.proyecto_id = project.proyecto_id AND projectSection.seccion_id = @sectionId
        ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS sectionBelongs,
        CASE WHEN @sectionId IS NOT NULL AND EXISTS (
          SELECT 1 FROM vcm.ProyectoSeccion projectSection
          INNER JOIN vcm.DocenteSeccion assignment ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
          INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
          WHERE projectSection.proyecto_id = project.proyecto_id AND projectSection.seccion_id = @sectionId
            AND (teacher.usuario_id = @userId OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email))
        ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS teacherAssigned,
        CASE WHEN @sectionId IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM vcm.HitoProyectoSeccion sectionMilestone
            WHERE sectionMilestone.proyecto_id = project.proyecto_id
              AND sectionMilestone.seccion_id = @sectionId
              AND sectionMilestone.numero = 1 AND sectionMilestone.estado = 'COMPLETADO'
          )
          AND EXISTS (
            SELECT 1 FROM vcm.HitoProyecto milestone
            WHERE milestone.proyecto_id = project.proyecto_id AND milestone.numero = 2
              AND milestone.disponible_desde IS NOT NULL
              AND milestone.disponible_desde <= CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific SA Standard Time')
          )
          AND NOT EXISTS (
            SELECT 1 FROM vcm.HitoProyectoSeccion closedMilestone
            WHERE closedMilestone.proyecto_id = project.proyecto_id
              AND closedMilestone.seccion_id = @sectionId
              AND closedMilestone.numero = 3 AND closedMilestone.estado = 'COMPLETADO'
          ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS deliverableOpen
      FROM vcm.Proyecto project WHERE project.codigo_publico = @code;
    `);
  const target = result.recordset[0];
  if (!target) throw new AppError(404, "PROJECT_NOT_FOUND", "No se encontró el proyecto.");
  if (!target.sectionBelongs) throw new AppError(404, "PROJECT_SECTION_NOT_FOUND", "La sección no pertenece a este proyecto.");
  if (descriptor.category === "ANTECEDENTE" && !["admin", "coordinator"].includes(principal.role)) {
    throw new AppError(403, "FILE_UPLOAD_DENIED", "No tienes permiso para adjuntar antecedentes a la propuesta.");
  }
  if (descriptor.category === "ANTECEDENTE" && ["FINALIZADO", "CANCELADO"].includes(target.projectStatus)) {
    throw new AppError(409, "PROJECT_FILE_LOCKED", "No se pueden modificar los antecedentes de un proyecto cerrado.");
  }
  if (descriptor.category === "ENTREGABLE_HITO_2"
    && (!(principal.role === "teacher" || principal.role === "coordinator") || !principal.canTeach || !target.teacherAssigned)) {
    throw new AppError(403, "FILE_UPLOAD_DENIED", "No tienes permiso para adjuntar entregables en esta sección.");
  }
  if (descriptor.category === "ENTREGABLE_HITO_2" && !target.deliverableOpen) {
    throw new AppError(409, "DELIVERABLE_NOT_AVAILABLE", "El entregable sólo puede adjuntarse durante el Hito 2 y antes de cerrar la sección.");
  }
  return target;
}

async function saveMetadata(target, descriptor, fileId, storageKey, principal) {
  return withTransaction(async (transaction) => {
    const request = new sql.Request(transaction)
      .input("fileId", sql.UniqueIdentifier, fileId)
      .input("replaceFileId", sql.UniqueIdentifier, descriptor.replaceFileId)
      .input("projectId", sql.UniqueIdentifier, target.projectId)
      .input("sectionId", sql.UniqueIdentifier, descriptor.sectionId)
      .input("category", sql.VarChar(30), descriptor.category)
      .input("name", sql.NVarChar(260), descriptor.name)
      .input("storageKey", sql.NVarChar(500), storageKey)
      .input("contentType", sql.NVarChar(150), descriptor.contentType)
      .input("size", sql.BigInt, descriptor.size)
      .input("actorId", sql.UniqueIdentifier, principal.id);
    const outputFields = `
      OUTPUT CONVERT(varchar(36), inserted.archivo_proyecto_id) AS id,
        inserted.nombre_original AS name, inserted.categoria AS category,
        CONVERT(varchar(36), inserted.seccion_id) AS sectionId,
        inserted.tipo_contenido AS contentType, inserted.tamano_bytes AS size,
        CONVERT(varchar(36), inserted.subido_por_usuario_id) AS uploadedBy,
        CONVERT(varchar(33), inserted.subido_en, 127) AS uploadedAt,
        inserted.clave_almacenamiento AS storageKey`;
    let result;
    if (descriptor.category === "ANTECEDENTE" && descriptor.replaceFileId) {
      result = await request.query(`
        UPDATE vcm.ArchivoProyecto WITH (UPDLOCK, HOLDLOCK)
        SET nombre_original = @name, clave_almacenamiento = @storageKey,
          tipo_contenido = @contentType, tamano_bytes = @size,
          subido_por_usuario_id = @actorId, subido_en = SYSUTCDATETIME()
        ${outputFields}, deleted.clave_almacenamiento AS previousStorageKey
        WHERE archivo_proyecto_id = @replaceFileId AND proyecto_id = @projectId
          AND categoria = 'ANTECEDENTE';
      `);
      if (!result.recordset.length) {
        throw new AppError(404, "PROJECT_FILE_NOT_FOUND", "No se encontró el antecedente que deseas reemplazar.");
      }
    } else if (descriptor.category === "ANTECEDENTE") {
      result = await request.query(`
        INSERT vcm.ArchivoProyecto
          (archivo_proyecto_id, proyecto_id, seccion_id, categoria, nombre_original, clave_almacenamiento,
           tipo_contenido, tamano_bytes, subido_por_usuario_id)
        ${outputFields}, CAST(NULL AS nvarchar(500)) AS previousStorageKey
        VALUES (@fileId, @projectId, NULL, @category, @name, @storageKey,
          @contentType, @size, @actorId);
      `);
    } else {
      result = await request.query(`
        MERGE vcm.ArchivoProyecto WITH (HOLDLOCK) AS target
        USING (SELECT @projectId AS projectId, @sectionId AS sectionId, @category AS category) AS source
          ON target.proyecto_id = source.projectId AND target.categoria = source.category
          AND target.seccion_id = source.sectionId
        WHEN MATCHED THEN UPDATE SET nombre_original = @name, clave_almacenamiento = @storageKey,
          tipo_contenido = @contentType, tamano_bytes = @size, subido_por_usuario_id = @actorId,
          subido_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (archivo_proyecto_id, proyecto_id, seccion_id, categoria, nombre_original, clave_almacenamiento,
           tipo_contenido, tamano_bytes, subido_por_usuario_id)
          VALUES (@fileId, @projectId, @sectionId, @category, @name, @storageKey,
            @contentType, @size, @actorId)
        ${outputFields}, deleted.clave_almacenamiento AS previousStorageKey;
      `);
    }
    const file = result.recordset[0];
    await writeAudit(transaction, principal, {
      action: descriptor.category === "ANTECEDENTE"
        ? (descriptor.replaceFileId ? "PROJECT_ANTECEDENT_REPLACED" : "PROJECT_ANTECEDENT_UPLOADED")
        : "PROJECT_DELIVERABLE_UPLOADED",
      entity: "ArchivoProyecto", entityId: file.id,
      description: `${descriptor.category === "ANTECEDENTE" ? "Antecedente" : "Entregable de Hito 2"} ${descriptor.name} almacenado en Blob Storage.`,
      data: {
        projectId: target.projectId, sectionId: descriptor.sectionId, category: descriptor.category,
        replacedFileId: descriptor.replaceFileId, size: descriptor.size,
      },
    });
    return file;
  });
}

async function uploadProjectFile(publicCode, input, body, principal) {
  const { projectFileMaxBytes } = getConfig();
  const descriptor = validateProjectFile({ ...input, size: body.length }, projectFileMaxBytes);
  const target = await authorizeUpload(publicCode, descriptor, principal);
  const fileId = crypto.randomUUID();
  const storageKey = buildStorageKey(target.projectId, fileId, descriptor);
  await uploadBlob(storageKey, body, descriptor.contentType);
  try {
    const file = await saveMetadata(target, descriptor, fileId, storageKey, principal);
    if (file.previousStorageKey && file.previousStorageKey !== storageKey) {
      await deleteBlobIfExists(file.previousStorageKey).catch(() => undefined);
    }
    const output = { ...file };
    delete output.storageKey;
    delete output.previousStorageKey;
    output.canDelete = descriptor.category === "ANTECEDENTE"
      && ["admin", "coordinator"].includes(principal.role)
      && !["FINALIZADO", "CANCELADO"].includes(target.projectStatus);
    return output;
  } catch (error) {
    await deleteBlobIfExists(storageKey).catch(() => undefined);
    throw error;
  }
}

async function deleteProjectFile(publicCode, fileId, principal) {
  if (!UUID_PATTERN.test(String(fileId || ""))) {
    throw new AppError(400, "INVALID_FILE_ID", "El identificador del archivo no es válido.");
  }
  const file = await withTransaction(async (transaction) => {
    const result = await new sql.Request(transaction)
      .input("code", sql.VarChar(30), publicCode)
      .input("fileId", sql.UniqueIdentifier, fileId)
      .query(`
        SELECT CONVERT(varchar(36), fileRow.archivo_proyecto_id) AS id,
          CONVERT(varchar(36), fileRow.proyecto_id) AS projectId,
          fileRow.nombre_original AS name, fileRow.clave_almacenamiento AS storageKey,
          fileRow.categoria AS category, project.estado AS projectStatus,
          CONVERT(varchar(36), fileRow.subido_por_usuario_id) AS uploadedBy
        FROM vcm.ArchivoProyecto fileRow WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN vcm.Proyecto project ON project.proyecto_id = fileRow.proyecto_id
        WHERE project.codigo_publico = @code AND fileRow.archivo_proyecto_id = @fileId;
      `);
    const target = result.recordset[0];
    if (!target) throw new AppError(404, "PROJECT_FILE_NOT_FOUND", "No se encontró el archivo solicitado.");
    assertProjectFileDeletionAllowed(target, principal);

    await new sql.Request(transaction)
      .input("fileId", sql.UniqueIdentifier, fileId)
      .query("DELETE FROM vcm.ArchivoProyecto WHERE archivo_proyecto_id = @fileId;");
    await writeAudit(transaction, principal, {
      action: "PROJECT_ANTECEDENT_DELETED", entity: "ArchivoProyecto", entityId: target.id,
      description: `Antecedente ${target.name} eliminado por un usuario autorizado.`,
      data: { projectId: target.projectId, category: target.category },
    });
    return target;
  });

  let storageCleaned = true;
  try {
    await deleteBlobIfExists(file.storageKey);
  } catch {
    storageCleaned = false;
    const pool = await getPool();
    await writeAudit(pool, principal, {
      action: "PROJECT_BLOB_CLEANUP_PENDING", entity: "ArchivoProyecto", entityId: file.id,
      description: `El antecedente ${file.name} fue retirado del proyecto, pero requiere limpieza posterior en Blob Storage.`,
      data: { projectId: file.projectId, category: file.category },
    }).catch(() => undefined);
  }
  return { id: file.id, name: file.name, deleted: true, storageCleaned };
}

async function getProjectFile(publicCode, fileId, principal) {
  if (!UUID_PATTERN.test(String(fileId || ""))) {
    throw new AppError(400, "INVALID_FILE_ID", "El identificador del archivo no es válido.");
  }
  const pool = await getPool();
  const result = await pool.request()
    .input("code", sql.VarChar(30), publicCode)
    .input("fileId", sql.UniqueIdentifier, fileId)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
    .query(`
      SELECT fileRow.nombre_original AS name, fileRow.clave_almacenamiento AS storageKey,
        fileRow.tipo_contenido AS contentType, fileRow.tamano_bytes AS size,
        fileRow.categoria AS category, CONVERT(varchar(36), fileRow.seccion_id) AS sectionId,
        CASE WHEN EXISTS (
          SELECT 1 FROM vcm.ProyectoSeccion projectSection
          INNER JOIN vcm.DocenteSeccion assignment ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
          INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
          WHERE projectSection.proyecto_id = project.proyecto_id
            AND (fileRow.seccion_id IS NULL OR projectSection.seccion_id = fileRow.seccion_id)
            AND (teacher.usuario_id = @userId OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email))
        ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS teacherAssigned
      FROM vcm.ArchivoProyecto fileRow
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = fileRow.proyecto_id
      WHERE project.codigo_publico = @code AND fileRow.archivo_proyecto_id = @fileId;
    `);
  const file = result.recordset[0];
  if (!file) throw new AppError(404, "PROJECT_FILE_NOT_FOUND", "No se encontró el archivo solicitado.");
  if (!["admin", "coordinator"].includes(principal.role) && !(principal.role === "teacher" && file.teacherAssigned)) {
    throw new AppError(403, "FILE_DOWNLOAD_DENIED", "No tienes permiso para descargar este archivo.");
  }
  const body = await downloadBlob(file.storageKey, getConfig().projectFileMaxBytes);
  return { ...file, body };
}

module.exports = { deleteProjectFile, getProjectFile, uploadProjectFile };
