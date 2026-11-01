const { randomUUID } = require("node:crypto");
const { sql, getPool, withTransaction } = require("../lib/db");
const { AppError } = require("../lib/http");
const { getConfig } = require("../lib/config");
const { writeAudit } = require("../lib/audit");
const { createReviewToken, hashReviewToken } = require("../lib/partnerReviews");
const { getHitoTwoAccess, assertHitoTwoOpen, getSectionTeams, getSectionFeedback } = require("../lib/hitoTwoWorkflow");
const { VIDEO_MAX_BYTES, buildDeliveryBlobName, validateVideoUpload, signVideoUpload, verifyVideoUpload } = require("../lib/videoUploads");

async function assertDeliveryOpen(connection, code, sectionId, principal) {
  const access = await getHitoTwoAccess(connection, code, sectionId, principal, true);
  assertHitoTwoOpen(access);
  if (await getSectionFeedback(connection, access.projectId, sectionId, { lock: true })) {
    throw new AppError(409, "VIDEO_DELIVERY_PUBLISHED", "Los videos ya fueron enviados al socio formador. Coordinación debe revocar esa revisión antes de permitir nuevas entregas.");
  }
  return access;
}

async function createVideoDeliveryLinks(publicCode, sectionId, principal) {
  return withTransaction(async (transaction) => {
    const access = await assertDeliveryOpen(transaction, publicCode, sectionId, principal);
    const teams = await getSectionTeams(transaction, access.projectId, sectionId, true);
    if (!teams.length) throw new AppError(409, "REVIEW_WITHOUT_TEAMS", "Primero deben conformarse los equipos.");
    const links = [];
    for (const team of teams) {
      const token = createReviewToken();
      const result = await new sql.Request(transaction).input("projectId", sql.UniqueIdentifier, access.projectId)
        .input("sectionId", sql.UniqueIdentifier, sectionId).input("teamId", sql.UniqueIdentifier, team.id)
        .input("hash", sql.Char(64), hashReviewToken(token)).query(`
          DECLARE @previous TABLE (archivo_nombre nvarchar(260), blob_confirmado nvarchar(500), tamano_bytes bigint, entregado_en datetime2(0));
          INSERT @previous SELECT TOP (1) archivo_nombre, blob_confirmado, tamano_bytes, entregado_en
            FROM vcm.EntregaVideoEquipo WITH (UPDLOCK, HOLDLOCK)
            WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND equipo_id = @teamId AND revocado_en IS NULL
            ORDER BY creado_en DESC, entrega_video_equipo_id DESC;
          UPDATE vcm.EntregaVideoEquipo SET revocado_en = COALESCE(revocado_en, SYSUTCDATETIME())
            WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND equipo_id = @teamId;
          INSERT vcm.EntregaVideoEquipo (proyecto_id, seccion_id, equipo_id, token_hash, vence_en, archivo_nombre, blob_confirmado, tamano_bytes, entregado_en)
          OUTPUT CONVERT(varchar(19), inserted.vence_en, 126) + 'Z' AS expiresAt
          SELECT @projectId, @sectionId, @teamId, @hash, DATEADD(day, 90, SYSUTCDATETIME()),
            previous.archivo_nombre, previous.blob_confirmado, previous.tamano_bytes, previous.entregado_en
          FROM (VALUES (1)) seed(n) OUTER APPLY (SELECT TOP (1) * FROM @previous) previous;
        `);
      links.push({ teamId: team.id, teamName: team.name, token, expiresAt: result.recordset[0].expiresAt });
    }
    await writeAudit(transaction, principal, { action: "VIDEO_DELIVERY_LINKS_CREATED", entity: "Proyecto", entityId: access.projectId,
      description: `Enlaces de entrega de videos creados para ${publicCode}.`, data: { sectionId, teamCount: teams.length } });
    return links;
  });
}

async function readDelivery(connection, token, lock = false) {
  const result = await new sql.Request(connection).input("hash", sql.Char(64), hashReviewToken(token)).query(`
    SELECT CONVERT(varchar(36), d.entrega_video_equipo_id) AS id, CONVERT(varchar(36), d.equipo_id) AS teamId,
      CONVERT(varchar(36), d.seccion_id) AS sectionId, p.codigo_publico AS projectCode, p.nombre AS projectName,
      team.nombre AS teamName, d.archivo_nombre AS filename,
      CONVERT(varchar(19), d.entregado_en, 126) + 'Z' AS deliveredAt,
      CONVERT(varchar(19), d.vence_en, 126) + 'Z' AS expiresAt,
      CONVERT(varchar(36), d.intento_id) AS attemptId, d.blob_pendiente AS pendingBlob,
      d.nombre_pendiente AS pendingName, d.tamano_esperado AS expectedSize,
      CONVERT(varchar(19), d.intento_vence_en, 126) + 'Z' AS attemptExpiresAt
    FROM vcm.EntregaVideoEquipo d ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
    INNER JOIN vcm.Proyecto p ON p.proyecto_id = d.proyecto_id AND p.estado = 'EN_EJECUCION'
    INNER JOIN vcm.ProyectoSeccion ps ON ps.proyecto_id = d.proyecto_id AND ps.seccion_id = d.seccion_id
    INNER JOIN vcm.Equipo team ON team.equipo_id = d.equipo_id AND team.proyecto_id = d.proyecto_id AND team.seccion_id = d.seccion_id
    WHERE d.token_hash = @hash AND d.revocado_en IS NULL AND d.vence_en > SYSUTCDATETIME()
      AND EXISTS (SELECT 1 FROM vcm.EquipoAlumno ea WHERE ea.equipo_id = team.equipo_id);
  `);
  if (!result.recordset[0]) throw new AppError(404, "VIDEO_DELIVERY_UNAVAILABLE", "Este enlace de entrega ya no está disponible. Solicita uno nuevo al docente.");
  return result.recordset[0];
}

async function studentContext(connection, token, mutation = false) {
  const delivery = await readDelivery(connection, token);
  // The validated bearer capability identifies the only project/section/team allowed.
  const principal = { role: "admin", id: null, email: "" };
  const access = mutation ? await assertDeliveryOpen(connection, delivery.projectCode, delivery.sectionId, principal)
    : await getHitoTwoAccess(connection, delivery.projectCode, delivery.sectionId, principal);
  if (!mutation) return { delivery, access };
  return { delivery: await readDelivery(connection, token, true), access };
}

async function getVideoDelivery(token) {
  const pool = await getPool();
  const { delivery, access } = await studentContext(pool, token);
  const review = await getSectionFeedback(pool, access.projectId, delivery.sectionId);
  const open = access.projectStatus === "EN_EJECUCION" && access.milestoneTwoStatus !== "COMPLETADO"
    && access.milestoneOneStatus === "COMPLETADO" && access.allMilestoneOneStatus === "COMPLETADO" && Boolean(access.available) && !review;
  return { projectName: delivery.projectName, teamName: delivery.teamName, campusName: access.campusName, sectionCode: access.sectionCode,
    filename: delivery.filename, deliveredAt: delivery.deliveredAt, open, uploadEnabled: Boolean(getConfig().videoUploadEnabled), maxBytes: VIDEO_MAX_BYTES };
}

async function beginVideoUpload(token, payload) {
  const input = validateVideoUpload(payload);
  if (!getConfig().videoUploadEnabled) throw new AppError(503, "VIDEO_UPLOAD_NOT_CONFIGURED", "La carga de videos aún no está habilitada. Contacta a coordinación.");
  const attempt = await withTransaction(async (transaction) => {
    const { delivery, access } = await studentContext(transaction, token, true);
    if (delivery.pendingBlob && Date.parse(delivery.attemptExpiresAt) > Date.now()) {
      if (delivery.pendingName !== input.name || Number(delivery.expectedSize) !== input.size) {
        throw new AppError(409, "VIDEO_UPLOAD_IN_PROGRESS", "Ya hay una carga en curso. Confírmala o espera 15 minutos antes de seleccionar otro archivo.");
      }
      return { id: delivery.attemptId, blobName: delivery.pendingBlob, expiresAt: delivery.attemptExpiresAt };
    }
    const id = randomUUID();
    const blobName = await buildDeliveryBlobName(access, delivery.teamId, id);
    const result = await new sql.Request(transaction).input("id", sql.UniqueIdentifier, delivery.id)
      .input("attemptId", sql.UniqueIdentifier, id).input("blob", sql.NVarChar(500), blobName)
      .input("name", sql.NVarChar(260), input.name).input("size", sql.BigInt, input.size).query(`
        UPDATE vcm.EntregaVideoEquipo SET intento_id = @attemptId, blob_pendiente = @blob,
          nombre_pendiente = @name, tamano_esperado = @size,
          intento_vence_en = CASE WHEN vence_en < DATEADD(minute, 15, SYSUTCDATETIME()) THEN vence_en ELSE DATEADD(minute, 15, SYSUTCDATETIME()) END
        OUTPUT CONVERT(varchar(19), inserted.intento_vence_en, 126) + 'Z' AS expiresAt
        WHERE entrega_video_equipo_id = @id;
      `);
    return { id, blobName, expiresAt: result.recordset[0].expiresAt };
  });
  const signed = await signVideoUpload(attempt.blobName, attempt.expiresAt);
  return { attemptId: attempt.id, ...signed };
}

async function confirmVideoUpload(token, attemptId) {
  // Inspect only the server-issued destination, outside the SQL transaction.
  const { delivery } = await studentContext(await getPool(), token);
  if (!delivery.attemptId || delivery.attemptId.toLowerCase() !== String(attemptId || "").toLowerCase()) {
    throw new AppError(409, "VIDEO_UPLOAD_CHANGED", "El intento de carga no coincide. Actualiza el enlace de entrega.");
  }
  if (Date.parse(delivery.attemptExpiresAt) <= Date.now()) throw new AppError(409, "VIDEO_UPLOAD_EXPIRED", "El intento de carga venció. Inicia uno nuevo.");
  await verifyVideoUpload(delivery.pendingBlob, Number(delivery.expectedSize));
  return withTransaction(async (transaction) => {
    const current = await studentContext(transaction, token, true);
    if (current.delivery.attemptId !== delivery.attemptId) throw new AppError(409, "VIDEO_UPLOAD_CHANGED", "La carga cambió. Actualiza el enlace.");
    if (Date.parse(current.delivery.attemptExpiresAt) <= Date.now()) throw new AppError(409, "VIDEO_UPLOAD_EXPIRED", "El intento de carga venció. Inicia uno nuevo.");
    const result = await new sql.Request(transaction).input("id", sql.UniqueIdentifier, delivery.id).query(`
      UPDATE vcm.EntregaVideoEquipo SET blob_confirmado = blob_pendiente, archivo_nombre = nombre_pendiente,
        tamano_bytes = tamano_esperado, entregado_en = CASE WHEN blob_confirmado = blob_pendiente THEN entregado_en ELSE SYSUTCDATETIME() END
      OUTPUT inserted.archivo_nombre AS filename, CONVERT(varchar(19), inserted.entregado_en, 126) + 'Z' AS deliveredAt
      WHERE entrega_video_equipo_id = @id;
    `);
    return result.recordset[0];
  });
}

module.exports = { createVideoDeliveryLinks, getVideoDelivery, beginVideoUpload, confirmVideoUpload };
