const { AppError } = require("../lib/http");
const { deleteBlobIfExists } = require("../lib/blobStorage");
const { getProtectedRemovedSectionIds } = require("../lib/projectEditing");
const { getTeachingStatus } = require("../lib/projectProgress");
const { UUID_PATTERN } = require("../lib/projectRoster");
const { assertTeacherProjectAccess, validateRosterAssignments } = require("../lib/projectTeams");
const { scopeSectionRows } = require("../lib/projectVisibility");
const { sql, getPool, withTransaction } = require("../lib/db");
const { writeAudit } = require("../lib/audit");
const { assertSectionFeedbackReviewed } = require("../lib/hitoTwoWorkflow");

const STATUS_LABELS = {
  PLANIFICADO: "Planificado",
  EN_EJECUCION: "En ejecución",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};
const PILOT_YEAR = "2026";

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
    return groups;
  }, new Map());
}

function requestFor(connection) {
  return new sql.Request(connection);
}

async function getProject(connection, publicCode, lock = false) {
  const result = await requestFor(connection)
    .input("code", sql.VarChar(30), publicCode)
    .query(`
      SELECT CONVERT(varchar(36), proyecto_id) AS id, estado AS status, nombre AS name
      FROM vcm.Proyecto ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      WHERE codigo_publico = @code;
    `);
  if (!result.recordset[0]) {
    throw new AppError(404, "PROJECT_NOT_FOUND", "No se encontró el proyecto.");
  }
  return result.recordset[0];
}

async function getProjectSection(connection, projectId, sectionId, lock = false) {
  const result = await requestFor(connection)
    .input("projectId", sql.UniqueIdentifier, projectId)
    .input("sectionId", sql.UniqueIdentifier, sectionId)
    .query(`
      SELECT CONVERT(varchar(36), projectSection.seccion_id) AS id,
        section.codigo AS code, campus.nombre AS campusName
      FROM vcm.ProyectoSeccion projectSection ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      WHERE projectSection.proyecto_id = @projectId AND projectSection.seccion_id = @sectionId;
    `);
  if (!result.recordset[0]) {
    throw new AppError(404, "PROJECT_SECTION_NOT_FOUND", "La sección no pertenece a este proyecto.");
  }
  return result.recordset[0];
}

async function getTeacherProject(connection, publicCode, principal, lock = false) {
  const result = await requestFor(connection)
    .input("code", sql.VarChar(30), publicCode)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
    .query(`
      SELECT CONVERT(varchar(36), project.proyecto_id) AS id, project.estado AS status,
        CONVERT(varchar(36), project.asignatura_id) AS subjectId,
        CASE WHEN EXISTS (
          SELECT 1 FROM vcm.ProyectoSeccion projectSection
          INNER JOIN vcm.DocenteSeccion assignment
            ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
          INNER JOIN vcm.Docente teacher
            ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
          WHERE projectSection.proyecto_id = project.proyecto_id
            AND (
              teacher.usuario_id = @userId
              OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)
            )
        ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS teacherAssigned
      FROM vcm.Proyecto project ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      WHERE project.codigo_publico = @code;
    `);
  const project = result.recordset[0];
  return assertTeacherProjectAccess(principal, project);
}

async function assertTeacherSectionAccess(connection, projectId, sectionId, principal, lock = false) {
  if (!sectionId) {
    throw new AppError(400, "SECTION_REQUIRED", "Debes seleccionar una sección.");
  }
  const result = await requestFor(connection)
    .input("projectId", sql.UniqueIdentifier, projectId)
    .input("sectionId", sql.UniqueIdentifier, sectionId)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
    .query(`
      SELECT CONVERT(varchar(36), projectSection.seccion_id) AS id, section.codigo AS code
      FROM vcm.ProyectoSeccion projectSection ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
      WHERE projectSection.proyecto_id = @projectId
        AND projectSection.seccion_id = @sectionId
        AND EXISTS (
          SELECT 1 FROM vcm.DocenteSeccion assignment
          INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
          WHERE assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
            AND (
              teacher.usuario_id = @userId
              OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)
            )
        );
    `);
  if (!result.recordset[0]) {
    throw new AppError(403, "SECTION_ACCESS_DENIED", "No tienes permiso para modificar esta sección del proyecto.");
  }
  return result.recordset[0];
}

async function syncProjectMilestone(connection, projectId, number, actorId) {
  await requestFor(connection)
    .input("projectId", sql.UniqueIdentifier, projectId)
    .input("number", sql.TinyInt, number)
    .input("actorId", sql.UniqueIdentifier, actorId)
    .query(`
      UPDATE projectMilestone
      SET estado = CASE WHEN completion.allCompleted = 1 THEN 'COMPLETADO' ELSE 'PENDIENTE' END,
        completado_en = CASE WHEN completion.allCompleted = 1
          THEN COALESCE(projectMilestone.completado_en, SYSUTCDATETIME()) ELSE NULL END,
        completado_por_usuario_id = CASE WHEN completion.allCompleted = 1
          THEN COALESCE(projectMilestone.completado_por_usuario_id, @actorId) ELSE NULL END
      FROM vcm.HitoProyecto projectMilestone
      CROSS APPLY (
        SELECT CASE WHEN COUNT(*) > 0
          AND SUM(CASE WHEN sectionMilestone.estado = 'COMPLETADO' THEN 1 ELSE 0 END) = COUNT(*)
          THEN 1 ELSE 0 END AS allCompleted
        FROM vcm.HitoProyectoSeccion sectionMilestone
        WHERE sectionMilestone.proyecto_id = @projectId AND sectionMilestone.numero = @number
      ) completion
      WHERE projectMilestone.proyecto_id = @projectId
        AND projectMilestone.numero = @number;
    `);
}

async function queryTeacherRoster(connection, projectId, principal, sectionId = null) {
  const result = await requestFor(connection)
    .input("projectId", sql.UniqueIdentifier, projectId)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
    .input("sectionId", sql.UniqueIdentifier, sectionId)
    .query(`
      SELECT CONVERT(varchar(36), student.alumno_id) AS id, student.rut,
        student.nombre_completo AS name, student.correo AS email,
        CONVERT(varchar(36), section.seccion_id) AS sectionId, section.codigo AS sectionCode,
        campus.nombre AS campusName, CONVERT(varchar(36), team.equipo_id) AS teamId,
        team.nombre AS teamName,
        COALESCE(studentStatus.estado, CASE WHEN team.equipo_id IS NULL THEN 'SIN_EQUIPO' ELSE 'ASIGNADO' END) AS assignmentStatus,
        CONVERT(varchar(33), studentStatus.actualizado_en, 127) AS assignmentUpdatedAt
      FROM vcm.Proyecto project
      INNER JOIN vcm.ProyectoSeccion projectSection ON projectSection.proyecto_id = project.proyecto_id
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id AND section.activa = 1
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.Matricula enrollment ON enrollment.seccion_id = section.seccion_id
        AND enrollment.asignatura_id = project.asignatura_id AND enrollment.vigente = 1
      INNER JOIN vcm.Alumno student ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
      LEFT JOIN vcm.EquipoAlumno membership ON membership.proyecto_id = project.proyecto_id
        AND membership.alumno_id = student.alumno_id
      LEFT JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id
      LEFT JOIN vcm.ProyectoAlumnoEstado studentStatus
        ON studentStatus.proyecto_id = project.proyecto_id
        AND studentStatus.seccion_id = section.seccion_id
        AND studentStatus.alumno_id = student.alumno_id
      WHERE project.proyecto_id = @projectId
        AND (@sectionId IS NULL OR section.seccion_id = @sectionId)
        AND EXISTS (
        SELECT 1 FROM vcm.DocenteSeccion assignment
        INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
        WHERE assignment.seccion_id = section.seccion_id AND assignment.vigente = 1
          AND (
            teacher.usuario_id = @userId
            OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)
          )
      )
      ORDER BY campus.nombre, section.codigo, student.nombre_completo;
    `);
  return result.recordset;
}

async function listProjects(principal) {
  const pool = await getPool();
  const teacherOnly = principal.role === "teacher";
  const request = pool.request()
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase());
  const filter = teacherOnly ? `
    WHERE EXISTS (
      SELECT 1 FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.DocenteSeccion assignment ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
      INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
      WHERE projectSection.proyecto_id = project.proyecto_id
        AND (
          teacher.usuario_id = @userId
          OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)
        )
    )` : "";

  const projectsResult = await request.query(`
    SELECT CONVERT(varchar(36), project.proyecto_id) AS databaseId, project.codigo_publico AS id,
      project.nombre AS name, CONVERT(varchar(36), project.socio_formador_id) AS partnerId,
      CONVERT(varchar(36), project.asignatura_id) AS subjectId, project.descripcion AS description,
      project.resultado_esperado AS expectedResult, CONVERT(char(10), project.fecha_inicio, 23) AS startDate,
      CONVERT(char(10), project.fecha_termino, 23) AS endDate, project.estado AS status,
      creator.nombre AS coordinatorName, creator.cargo_visual AS coordinatorTitle,
      CASE WHEN EXISTS (SELECT 1 FROM vcm.EntregaVideoEquipo delivery WHERE delivery.proyecto_id = project.proyecto_id)
        OR EXISTS (SELECT 1 FROM vcm.RevisionSocio review WHERE review.proyecto_id = project.proyecto_id)
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS milestoneTwoStarted,
      CASE WHEN EXISTS (
        SELECT 1
        FROM vcm.ProyectoSeccion assignedProjectSection
        INNER JOIN vcm.DocenteSeccion assignedSection
          ON assignedSection.seccion_id = assignedProjectSection.seccion_id AND assignedSection.vigente = 1
        INNER JOIN vcm.Docente assignedTeacher
          ON assignedTeacher.docente_id = assignedSection.docente_id AND assignedTeacher.activo = 1
        WHERE assignedProjectSection.proyecto_id = project.proyecto_id
          AND (
            assignedTeacher.usuario_id = @userId
            OR (assignedTeacher.usuario_id IS NULL AND LOWER(assignedTeacher.correo) = @email)
          )
      ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS teacherAssigned,
      CONVERT(varchar(36), project.creado_por_usuario_id) AS createdBy
    FROM vcm.Proyecto project
    INNER JOIN vcm.Usuario creator ON creator.usuario_id = project.creado_por_usuario_id
    ${filter}
    ORDER BY project.creado_en DESC;
  `);

  if (!projectsResult.recordset.length) return [];
  const [campusesResult, sectionsResult, milestonesResult, sectionMilestonesResult, sectionProgressResult, teachingSectionsResult, teachersResult, teamsResult, membershipsResult, filesResult] = await Promise.all([
    pool.request().query(`SELECT CONVERT(varchar(36), link.proyecto_id) AS projectId, CONVERT(varchar(36), link.sede_id) AS campusId FROM vcm.ProyectoSede link;`),
    pool.request().query(`
      SELECT CONVERT(varchar(36), link.proyecto_id) AS projectId,
        CONVERT(varchar(36), link.seccion_id) AS sectionId,
        CONVERT(varchar(36), section.sede_id) AS campusId
      FROM vcm.ProyectoSeccion link
      INNER JOIN vcm.Seccion section ON section.seccion_id = link.seccion_id;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), proyecto_id) AS projectId, numero AS number,
        estado AS status, CONVERT(varchar(33), completado_en, 127) AS completedAt,
        CONVERT(char(10), disponible_desde, 23) AS availableFrom,
        CASE WHEN disponible_desde IS NOT NULL
          AND disponible_desde <= CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific SA Standard Time')
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS available
      FROM vcm.HitoProyecto;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), proyecto_id) AS projectId,
        CONVERT(varchar(36), seccion_id) AS sectionId, numero AS number,
        estado AS status, CONVERT(varchar(33), completado_en, 127) AS completedAt
      FROM vcm.HitoProyectoSeccion;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), proyecto_id) AS projectId,
        CONVERT(varchar(36), seccion_id) AS sectionId,
        avance_resultado AS advance, conclusiones, CONVERT(varchar(36), revision_socio_id) AS reviewId,
        CONVERT(varchar(19), retroalimentacion_revisada_en, 126) + 'Z' AS feedbackReviewedAt,
        CONVERT(varchar(33), registrado_en, 127) AS registeredAt
      FROM vcm.AvanceProyectoSeccion;
    `),
    pool.request()
      .input("userId", sql.UniqueIdentifier, principal.id)
      .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
      .query(`
        SELECT DISTINCT CONVERT(varchar(36), projectSection.proyecto_id) AS projectId,
          CONVERT(varchar(36), projectSection.seccion_id) AS sectionId
        FROM vcm.ProyectoSeccion projectSection
        INNER JOIN vcm.DocenteSeccion assignment
          ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
        INNER JOIN vcm.Docente teacher
          ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
        WHERE teacher.usuario_id = @userId
          OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email);
      `),
    pool.request().query(`
      SELECT DISTINCT CONVERT(varchar(36), projectSection.proyecto_id) AS projectId,
        CONVERT(varchar(36), projectSection.seccion_id) AS sectionId,
        COALESCE(CONVERT(varchar(36), teacher.usuario_id), CONVERT(varchar(36), teacher.docente_id)) AS teacherId,
        teacher.nombre AS teacherName
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.DocenteSeccion assignment ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
      INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), team.equipo_id) AS id,
        CONVERT(varchar(36), team.proyecto_id) AS projectId,
        CONVERT(varchar(36), team.seccion_id) AS sectionId, team.nombre AS name
      FROM vcm.Equipo team ORDER BY team.nombre;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), membership.equipo_id) AS teamId,
        CONVERT(varchar(36), membership.alumno_id) AS studentId
      FROM vcm.EquipoAlumno membership;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), archivo_proyecto_id) AS id,
        CONVERT(varchar(36), proyecto_id) AS projectId,
        CONVERT(varchar(36), seccion_id) AS sectionId,
        categoria AS category, nombre_original AS name,
        tipo_contenido AS contentType, tamano_bytes AS size,
        CONVERT(varchar(36), subido_por_usuario_id) AS uploadedBy,
        CONVERT(varchar(33), subido_en, 127) AS uploadedAt
      FROM vcm.ArchivoProyecto;
    `),
  ]);

  const campuses = groupBy(campusesResult.recordset, "projectId");
  const sections = groupBy(sectionsResult.recordset, "projectId");
  const milestones = groupBy(milestonesResult.recordset, "projectId");
  const sectionMilestones = groupBy(sectionMilestonesResult.recordset, "projectId");
  const sectionProgress = groupBy(sectionProgressResult.recordset, "projectId");
  const teachingSections = groupBy(teachingSectionsResult.recordset, "projectId");
  const teachers = groupBy(teachersResult.recordset, "projectId");
  const teams = groupBy(teamsResult.recordset, "projectId");
  const memberships = groupBy(membershipsResult.recordset, "teamId");
  const files = groupBy(filesResult.recordset, "projectId");
  return projectsResult.recordset.map((project) => {
    const projectMilestones = (milestones.get(project.databaseId) || []).sort((left, right) => left.number - right.number);
    const allProjectSections = sections.get(project.databaseId) || [];
    const projectSectionMilestones = sectionMilestones.get(project.databaseId) || [];
    const projectSectionProgress = sectionProgress.get(project.databaseId) || [];
    const teachingSectionIds = (teachingSections.get(project.databaseId) || []).map((item) => item.sectionId);
    const visibleProjectSections = scopeSectionRows(allProjectSections, teachingSectionIds, teacherOnly);
    const projectSectionIds = visibleProjectSections.map((item) => item.sectionId);
    const projectTeachers = scopeSectionRows(teachers.get(project.databaseId) || [], teachingSectionIds, teacherOnly);
    const projectFiles = files.get(project.databaseId) || [];
    const projectAttachments = projectFiles
      .filter((file) => file.category === "ANTECEDENTE")
      .sort((left, right) => String(right.uploadedAt || "").localeCompare(String(left.uploadedAt || "")))
      .map((file) => ({
        id: file.id,
        name: file.name,
        contentType: file.contentType,
        size: Number(file.size || 0),
        uploadedAt: file.uploadedAt,
        uploadedBy: file.uploadedBy,
        canDelete: (principal.role === "admin"
          || (principal.role === "coordinator"
            && String(file.uploadedBy || "").toLowerCase() === String(principal.id || "").toLowerCase()))
          && !["FINALIZADO", "CANCELADO"].includes(project.status),
      }));
    const latestAttachment = projectAttachments[0] || null;
    const projectSectionStates = projectSectionIds.map((sectionId) => {
      const savedProgress = projectSectionProgress.find((item) => item.sectionId === sectionId);
      const deliverable = projectFiles.find((item) => item.category === "ENTREGABLE_HITO_2" && item.sectionId === sectionId);
      return {
        sectionId,
        progress: savedProgress ? {
          advance: savedProgress.advance,
          conclusions: savedProgress.conclusions,
          reviewId: savedProgress.reviewId,
          feedbackReviewedAt: savedProgress.feedbackReviewedAt,
          deliverableId: deliverable?.id || null,
          deliverableName: deliverable?.name || "",
          deliverable: deliverable ? {
            id: deliverable.id,
            name: deliverable.name,
            contentType: deliverable.contentType,
            size: Number(deliverable.size || 0),
            uploadedAt: deliverable.uploadedAt,
          } : null,
          registeredAt: savedProgress.registeredAt,
        } : null,
        milestones: [1, 2, 3].map((number) => {
          const milestone = projectSectionMilestones.find((item) => item.sectionId === sectionId && item.number === number);
          return {
            id: number,
            name: ["Inicio y equipos", "Avance y resultados", "Cierre"][number - 1],
            status: milestone?.status === "COMPLETADO" ? "Completado" : "Pendiente",
            completedAt: milestone?.completedAt || null,
          };
        }),
      };
    });
    const displayedMilestones = [1, 2, 3].map((number) => {
      const globalMilestone = projectMilestones.find((item) => item.number === number);
      const ownMilestones = projectSectionStates.map((state) => state.milestones[number - 1]);
      const ownComplete = ownMilestones.length > 0 && ownMilestones.every((milestone) => milestone.status === "Completado");
      const completedAt = ownComplete
        ? ownMilestones.map((milestone) => milestone.completedAt).filter(Boolean).sort().at(-1) || null
        : null;
      return {
        id: number,
        name: ["Inicio y equipos", "Avance y resultados", "Cierre"][number - 1],
        status: (teacherOnly ? ownComplete : globalMilestone?.status === "COMPLETADO") ? "Completado" : "Pendiente",
        completedAt: teacherOnly ? completedAt : globalMilestone?.completedAt || null,
        availableFrom: globalMilestone?.availableFrom || null,
        available: number === 1 || number === 3 ? true : Boolean(globalMilestone?.available),
      };
    });
    return {
      databaseId: project.databaseId,
      id: project.id,
      name: project.name,
      partnerId: project.partnerId,
      subjectId: project.subjectId,
      description: project.description,
      expectedResult: project.expectedResult,
      startDate: project.startDate,
      endDate: project.endDate,
      status: STATUS_LABELS[project.status] || project.status,
      teacherAssigned: Boolean(project.teacherAssigned),
      milestoneTwoStarted: Boolean(project.milestoneTwoStarted),
      teachingStatus: getTeachingStatus(projectSectionStates, teachingSectionIds),
      teachingSectionIds,
      createdBy: project.createdBy,
      coordinatorName: project.coordinatorName,
      coordinatorTitle: project.coordinatorTitle,
      attachments: projectAttachments,
      attachmentId: latestAttachment?.id || null,
      attachmentName: latestAttachment?.name || null,
      attachment: latestAttachment,
      campusIds: teacherOnly
        ? [...new Set(visibleProjectSections.map((section) => section.campusId))]
        : (campuses.get(project.databaseId) || []).map((item) => item.campusId),
      sectionIds: projectSectionIds,
      teacherIds: [...new Set(projectTeachers.map((item) => item.teacherId))],
      teacherNames: [...new Set(projectTeachers.map((item) => item.teacherName))],
      teams: scopeSectionRows(teams.get(project.databaseId) || [], teachingSectionIds, teacherOnly).map((team) => ({
        id: team.id,
        sectionId: team.sectionId,
        name: team.name,
        studentIds: (memberships.get(team.id) || []).map((membership) => membership.studentId),
      })),
      sectionStates: projectSectionStates,
      milestones: displayedMilestones,
    };
  });
}

async function listProjectRoster(publicCode, principal) {
  const pool = await getPool();
  const project = await getTeacherProject(pool, publicCode, principal);
  return queryTeacherRoster(pool, project.id, principal);
}

async function assertSectionRosterEditable(connection, sectionId) {
  const result = await requestFor(connection)
    .input("sectionId", sql.UniqueIdentifier, sectionId)
    .query(`
      SELECT TOP (1) project.codigo_publico AS projectCode
      FROM vcm.ProyectoSeccion projectSection WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
      LEFT JOIN vcm.HitoProyectoSeccion milestoneThree
        ON milestoneThree.proyecto_id = projectSection.proyecto_id
        AND milestoneThree.seccion_id = projectSection.seccion_id
        AND milestoneThree.numero = 3
      WHERE projectSection.seccion_id = @sectionId
        AND (project.estado IN ('FINALIZADO', 'CANCELADO') OR milestoneThree.estado = 'COMPLETADO');
    `);
  if (result.recordset[0]) {
    throw new AppError(409, "SECTION_ROSTER_LOCKED", `La nómina no puede modificarse porque la sección ya fue cerrada en el proyecto ${result.recordset[0].projectCode}.`);
  }
}

async function addProjectStudent(publicCode, input, principal) {
  return withTransaction(async (transaction) => {
    const project = await getTeacherProject(transaction, publicCode, principal, true);
    if (["FINALIZADO", "CANCELADO"].includes(project.status)) {
      throw new AppError(409, "PROJECT_NOT_EDITABLE", "El proyecto ya no permite modificar la nómina de sus secciones.");
    }
    const section = await assertTeacherSectionAccess(transaction, project.id, input.sectionId, principal, true);
    await assertSectionRosterEditable(transaction, input.sectionId);

    const studentResult = await requestFor(transaction)
      .input("rut", sql.VarChar(20), input.rut)
      .input("name", sql.NVarChar(180), input.name)
      .query(`
        MERGE vcm.Alumno WITH (HOLDLOCK) AS target
        USING (SELECT @rut AS rut, @name AS name) AS source
          ON target.rut = source.rut
        WHEN MATCHED THEN UPDATE SET nombre_completo = source.name, activo = 1,
          actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (identificador_externo, rut, nombre_completo, correo, activo)
          VALUES (CONCAT(N'MANUAL-', source.rut), source.rut, source.name, NULL, 1)
        OUTPUT CONVERT(varchar(36), inserted.alumno_id) AS id;
      `);
    const studentId = studentResult.recordset[0].id;

    const enrollmentResult = await requestFor(transaction)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .input("subjectId", sql.UniqueIdentifier, project.subjectId)
      .query(`
        SELECT CONVERT(varchar(36), enrollment.matricula_id) AS id,
          CONVERT(varchar(36), enrollment.seccion_id) AS sectionId,
          enrollment.vigente AS active, section.codigo AS sectionCode
        FROM vcm.Matricula enrollment WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN vcm.Seccion section ON section.seccion_id = enrollment.seccion_id
        WHERE enrollment.alumno_id = @studentId AND enrollment.asignatura_id = @subjectId;
      `);
    const existingEnrollment = enrollmentResult.recordset[0];
    if (existingEnrollment?.active && existingEnrollment.sectionId === input.sectionId) {
      throw new AppError(409, "STUDENT_ALREADY_ENROLLED", "El estudiante ya pertenece a esta sección.");
    }
    if (existingEnrollment?.active) {
      throw new AppError(409, "STUDENT_ENROLLED_OTHER_SECTION", `El estudiante ya tiene una matrícula vigente en la sección ${existingEnrollment.sectionCode}. Retíralo allí antes de agregarlo a esta sección.`);
    }

    await requestFor(transaction)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .input("subjectId", sql.UniqueIdentifier, project.subjectId)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .query(`
        MERGE vcm.Matricula WITH (HOLDLOCK) AS target
        USING (SELECT @studentId AS studentId, @subjectId AS subjectId) AS source
          ON target.alumno_id = source.studentId AND target.asignatura_id = source.subjectId
        WHEN MATCHED THEN UPDATE SET seccion_id = @sectionId, carga_academica_id = NULL,
          vigente = 1, matriculado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (alumno_id, asignatura_id, seccion_id, carga_academica_id, vigente)
          VALUES (@studentId, @subjectId, @sectionId, NULL, 1);
      `);

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        DELETE membership
        FROM vcm.EquipoAlumno membership
        INNER JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id
        WHERE membership.proyecto_id = @projectId
          AND membership.alumno_id = @studentId;

        MERGE vcm.ProyectoAlumnoEstado WITH (HOLDLOCK) AS target
        USING (SELECT @projectId AS projectId, @studentId AS studentId) AS source
          ON target.proyecto_id = source.projectId AND target.alumno_id = source.studentId
        WHEN MATCHED THEN UPDATE SET seccion_id = @sectionId, estado = 'SIN_EQUIPO',
          actualizado_por_usuario_id = @actorId, actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (proyecto_id, seccion_id, alumno_id, estado, actualizado_por_usuario_id)
          VALUES (@projectId, @sectionId, @studentId, 'SIN_EQUIPO', @actorId);
      `);

    await writeAudit(transaction, principal, {
      action: "SECTION_STUDENT_ADDED", entity: "Matricula", entityId: studentId,
      description: `${input.name} fue agregado manualmente a la sección ${section.code} desde el proyecto ${publicCode}.`,
      data: {
        projectId: project.id, sectionId: input.sectionId, rut: input.rut,
        reactivated: Boolean(existingEnrollment), previousSectionId: existingEnrollment?.sectionId || null,
      },
    });
    const roster = await queryTeacherRoster(transaction, project.id, principal, input.sectionId);
    return roster.find((student) => student.id === studentId);
  });
}

async function removeProjectStudent(publicCode, studentId, input, principal) {
  if (!UUID_PATTERN.test(String(studentId || ""))) {
    throw new AppError(400, "INVALID_STUDENT_ID", "El identificador del estudiante no es válido.");
  }
  return withTransaction(async (transaction) => {
    const project = await getTeacherProject(transaction, publicCode, principal, true);
    if (["FINALIZADO", "CANCELADO"].includes(project.status)) {
      throw new AppError(409, "PROJECT_NOT_EDITABLE", "El proyecto ya no permite modificar la nómina de sus secciones.");
    }
    const section = await assertTeacherSectionAccess(transaction, project.id, input.sectionId, principal, true);
    await assertSectionRosterEditable(transaction, input.sectionId);
    const roster = await queryTeacherRoster(transaction, project.id, principal, input.sectionId);
    const student = roster.find((item) => item.id === studentId);
    if (!student) {
      throw new AppError(404, "STUDENT_NOT_IN_ROSTER", "El estudiante no pertenece a la nómina vigente de esta sección.");
    }

    const enrollmentUpdate = await requestFor(transaction)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .input("subjectId", sql.UniqueIdentifier, project.subjectId)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .query(`
        UPDATE vcm.Matricula
        SET vigente = 0
        WHERE alumno_id = @studentId AND asignatura_id = @subjectId
          AND seccion_id = @sectionId AND vigente = 1;
        SELECT @@ROWCOUNT AS affected;
      `);
    if (enrollmentUpdate.recordset[0]?.affected !== 1) {
      throw new AppError(409, "STUDENT_ENROLLMENT_CHANGED", "La matrícula del estudiante cambió mientras se procesaba la solicitud. Recarga la página e inténtalo nuevamente.");
    }

    await requestFor(transaction)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        DELETE membership
        FROM vcm.EquipoAlumno membership
        INNER JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id
        WHERE membership.alumno_id = @studentId AND team.seccion_id = @sectionId;

        UPDATE studentStatus
        SET estado = 'SIN_EQUIPO', actualizado_por_usuario_id = @actorId,
          actualizado_en = SYSUTCDATETIME()
        FROM vcm.ProyectoAlumnoEstado studentStatus
        INNER JOIN vcm.ProyectoSeccion projectSection
          ON projectSection.proyecto_id = studentStatus.proyecto_id
          AND projectSection.seccion_id = studentStatus.seccion_id
        WHERE studentStatus.alumno_id = @studentId
          AND studentStatus.seccion_id = @sectionId;

        DELETE team
        FROM vcm.Equipo team
        WHERE team.seccion_id = @sectionId
          AND NOT EXISTS (
            SELECT 1 FROM vcm.EquipoAlumno membership WHERE membership.equipo_id = team.equipo_id
          );
      `);

    await writeAudit(transaction, principal, {
      action: "SECTION_STUDENT_REMOVED", entity: "Matricula", entityId: studentId,
      description: `${student.name} fue retirado visualmente de la sección ${section.code} desde el proyecto ${publicCode}.`,
      data: {
        projectId: project.id, sectionId: input.sectionId, rut: student.rut,
        previousStatus: student.assignmentStatus, previousTeam: student.teamName || null,
      },
    });
    return { id: studentId, sectionId: input.sectionId, name: student.name, removed: true };
  });
}

async function scheduleMilestoneTwo(publicCode, input, principal) {
  await withTransaction(async (transaction) => {
    const project = await getProject(transaction, publicCode, true);
    if (["FINALIZADO", "CANCELADO"].includes(project.status)) {
      throw new AppError(409, "PROJECT_NOT_SCHEDULABLE", "El proyecto ya no permite programar el Hito 2.");
    }

    const readiness = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("availableFrom", sql.Date, input.availableFrom)
      .query(`
        SELECT
          (SELECT estado FROM vcm.HitoProyecto WITH (UPDLOCK, HOLDLOCK)
            WHERE proyecto_id = @projectId AND numero = 1) AS milestoneOneStatus,
          (SELECT COUNT(*) FROM vcm.HitoProyectoSeccion
            WHERE proyecto_id = @projectId AND numero = 2 AND estado = 'COMPLETADO') AS milestoneTwoCompletedSections,
          CASE WHEN EXISTS (SELECT 1 FROM vcm.EntregaVideoEquipo WHERE proyecto_id = @projectId)
            OR EXISTS (SELECT 1 FROM vcm.RevisionSocio WHERE proyecto_id = @projectId)
            THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS videoDeliveryStarted,
          CASE WHEN @availableFrom < CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific SA Standard Time')
            THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS dateInPast;
      `);
    const state = readiness.recordset[0];
    if (state.milestoneOneStatus !== "COMPLETADO") {
      throw new AppError(409, "MILESTONE_ONE_INCOMPLETE", "Todas las secciones deben completar el Hito 1 antes de programar el Hito 2.");
    }
    if (state.milestoneTwoCompletedSections > 0 || state.videoDeliveryStarted) {
      throw new AppError(409, "MILESTONE_TWO_ALREADY_STARTED", "La fecha ya no puede modificarse porque ya se iniciaron las entregas del Hito 2.");
    }
    if (state.dateInPast) {
      throw new AppError(400, "MILESTONE_DATE_IN_PAST", "La fecha de apertura no puede estar en el pasado.");
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("availableFrom", sql.Date, input.availableFrom)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        UPDATE vcm.HitoProyecto
        SET disponible_desde = @availableFrom,
          habilitado_en = SYSUTCDATETIME(),
          habilitado_por_usuario_id = @actorId
        WHERE proyecto_id = @projectId AND numero = 2;
      `);
    await writeAudit(transaction, principal, {
      action: "PROJECT_MILESTONE_TWO_SCHEDULED", entity: "Proyecto", entityId: project.id,
      description: `Hito 2 del proyecto ${publicCode} programado desde ${input.availableFrom}.`,
      data: { availableFrom: input.availableFrom },
    });
  });

  const projects = await listProjects(principal);
  return { project: projects.find((project) => project.id === publicCode) };
}

async function reopenSectionMilestone(publicCode, input, principal) {
  await withTransaction(async (transaction) => {
    const project = await getProject(transaction, publicCode, true);
    if (project.status === "CANCELADO") {
      throw new AppError(409, "PROJECT_CANCELLED", "No se pueden reabrir hitos de un proyecto cancelado.");
    }
    const section = await getProjectSection(transaction, project.id, input.sectionId, true);
    const milestone = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .input("number", sql.TinyInt, input.milestoneNumber)
      .query(`
        SELECT estado AS status
        FROM vcm.HitoProyectoSeccion WITH (UPDLOCK, HOLDLOCK)
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero = @number;
      `);
    if (milestone.recordset[0]?.status !== "COMPLETADO") {
      throw new AppError(409, "MILESTONE_NOT_COMPLETED", "Sólo se puede reabrir un hito que esté completado.");
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .input("number", sql.TinyInt, input.milestoneNumber)
      .query(`
        UPDATE vcm.HitoProyectoSeccion
        SET estado = 'PENDIENTE', completado_en = NULL, completado_por_usuario_id = NULL
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero >= @number;
      `);

    for (let number = input.milestoneNumber; number <= 3; number += 1) {
      await syncProjectMilestone(transaction, project.id, number, principal.id);
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        UPDATE project
        SET estado = CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM vcm.HitoProyectoSeccion milestone
              WHERE milestone.proyecto_id = @projectId AND milestone.numero = 3
                AND milestone.estado <> 'COMPLETADO'
            ) THEN 'FINALIZADO'
            WHEN EXISTS (
              SELECT 1 FROM vcm.HitoProyectoSeccion milestone
              WHERE milestone.proyecto_id = @projectId AND milestone.numero = 1
                AND milestone.estado = 'COMPLETADO'
            ) THEN 'EN_EJECUCION'
            ELSE 'PLANIFICADO'
          END,
          cerrado_en = CASE WHEN NOT EXISTS (
              SELECT 1 FROM vcm.HitoProyectoSeccion milestone
              WHERE milestone.proyecto_id = @projectId AND milestone.numero = 3
                AND milestone.estado <> 'COMPLETADO'
            ) THEN COALESCE(project.cerrado_en, SYSUTCDATETIME()) ELSE NULL END,
          actualizado_en = SYSUTCDATETIME()
        FROM vcm.Proyecto project
        WHERE project.proyecto_id = @projectId;
      `);
    await writeAudit(transaction, principal, {
      action: "PROJECT_SECTION_MILESTONE_REOPENED", entity: "Proyecto", entityId: project.id,
      description: `Hito ${input.milestoneNumber} reabierto para la sección ${section.code} (${section.campusName}) del proyecto ${publicCode}.`,
      data: { sectionId: input.sectionId, milestoneNumber: input.milestoneNumber, reason: input.reason },
    });
  });

  const projects = await listProjects(principal);
  return { project: projects.find((project) => project.id === publicCode) };
}

async function startProject(publicCode, assignment, principal) {
  const result = await withTransaction(async (transaction) => {
    const project = await getTeacherProject(transaction, publicCode, principal, true);
    if (!["PLANIFICADO", "EN_EJECUCION"].includes(project.status)) {
      throw new AppError(409, "PROJECT_NOT_EDITABLE", "El proyecto ya no permite modificar sus equipos.");
    }

    const { teams, studentStates, sectionId } = assignment;
    const section = await assertTeacherSectionAccess(transaction, project.id, sectionId, principal, true);
    const sectionMilestone = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, sectionId)
      .query(`
        SELECT estado AS status FROM vcm.HitoProyectoSeccion WITH (UPDLOCK, HOLDLOCK)
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero = 1;
      `);
    if (sectionMilestone.recordset[0]?.status === "COMPLETADO") {
      throw new AppError(409, "MILESTONE_REOPEN_REQUIRED", "Coordinación debe reabrir el Hito 1 antes de modificar los equipos de esta sección.");
    }
    const roster = await queryTeacherRoster(transaction, project.id, principal, sectionId);
    validateRosterAssignments(teams, roster, studentStates);

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, sectionId)
      .query(`
        DELETE FROM vcm.Equipo
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId;
      `);

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .input("studentStates", sql.NVarChar(sql.MAX), JSON.stringify(studentStates))
      .query(`
        MERGE vcm.ProyectoAlumnoEstado WITH (HOLDLOCK) AS target
        USING (
          SELECT @projectId AS projectId, parsed.studentId, parsed.sectionId, parsed.status
          FROM OPENJSON(@studentStates) WITH (
            studentId uniqueidentifier '$.studentId',
            sectionId uniqueidentifier '$.sectionId',
            status varchar(20) '$.status'
          ) parsed
        ) AS source
          ON target.proyecto_id = source.projectId AND target.alumno_id = source.studentId
        WHEN MATCHED THEN UPDATE SET seccion_id = source.sectionId, estado = source.status,
          actualizado_por_usuario_id = @actorId, actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (proyecto_id, seccion_id, alumno_id, estado, actualizado_por_usuario_id)
          VALUES (source.projectId, source.sectionId, source.studentId, source.status, @actorId);
      `);

    for (const team of teams) {
      const created = await requestFor(transaction)
        .input("projectId", sql.UniqueIdentifier, project.id)
        .input("sectionId", sql.UniqueIdentifier, team.sectionId)
        .input("name", sql.NVarChar(100), team.name)
        .input("actorId", sql.UniqueIdentifier, principal.id)
        .query(`
          INSERT INTO vcm.Equipo (proyecto_id, seccion_id, nombre, creado_por_usuario_id)
          OUTPUT CONVERT(varchar(36), inserted.equipo_id) AS id
          VALUES (@projectId, @sectionId, @name, @actorId);
        `);
      await requestFor(transaction)
        .input("teamId", sql.UniqueIdentifier, created.recordset[0].id)
        .input("projectId", sql.UniqueIdentifier, project.id)
        .input("studentIds", sql.NVarChar(sql.MAX), JSON.stringify(team.studentIds))
        .query(`
          INSERT INTO vcm.EquipoAlumno (equipo_id, alumno_id, proyecto_id)
          SELECT @teamId, TRY_CONVERT(uniqueidentifier, [value]), @projectId
          FROM OPENJSON(@studentIds);
        `);
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, sectionId)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        UPDATE vcm.Proyecto
        SET estado = 'EN_EJECUCION', actualizado_en = SYSUTCDATETIME()
        WHERE proyecto_id = @projectId AND estado = 'PLANIFICADO';

        UPDATE vcm.HitoProyectoSeccion
        SET estado = 'COMPLETADO', completado_en = COALESCE(completado_en, SYSUTCDATETIME()),
          completado_por_usuario_id = COALESCE(completado_por_usuario_id, @actorId)
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero = 1;
      `);
    await syncProjectMilestone(transaction, project.id, 1, principal.id);

    const summary = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        SELECT COUNT(*) AS totalSections,
          SUM(CASE WHEN milestone.estado = 'COMPLETADO' THEN 1 ELSE 0 END) AS completedSections
        FROM vcm.HitoProyectoSeccion milestone
        WHERE milestone.proyecto_id = @projectId AND milestone.numero = 1;
      `);
    const totals = summary.recordset[0];
    const projectMilestoneCompleted = totals.totalSections > 0 && totals.totalSections === totals.completedSections;
    await writeAudit(transaction, principal, {
      action: "PROJECT_TEAMS_SAVED", entity: "Proyecto", entityId: project.id,
      description: `Hito 1 completado para la sección ${section.code} del proyecto ${publicCode}.`,
      data: {
        sectionId, teams: teams.length, sectionStudents: roster.length,
        assignedStudents: studentStates.filter((student) => student.status === "ASIGNADO").length,
        studentsWithoutTeam: studentStates.filter((student) => student.status === "SIN_EQUIPO").length,
        dropoutStudents: studentStates.filter((student) => student.status === "DESERTOR").length,
        projectMilestoneCompleted,
      },
    });
    return {
      sectionId,
      sectionCode: section.code,
      sectionStudents: roster.length,
      milestoneCompleted: true,
      completedSections: totals.completedSections,
      totalSections: totals.totalSections,
      projectMilestoneCompleted,
    };
  });

  const projects = await listProjects(principal);
  return { ...result, project: projects.find((project) => project.id === publicCode) };
}

async function validateProjectReferences(connection, input, existingProjectId = null) {
  const references = await requestFor(connection)
    .input("projectId", sql.UniqueIdentifier, existingProjectId)
    .input("partnerId", sql.UniqueIdentifier, input.partnerId)
    .input("subjectId", sql.UniqueIdentifier, input.subjectId)
    .input("campusIds", sql.NVarChar(sql.MAX), JSON.stringify(input.campusIds))
    .input("sectionIds", sql.NVarChar(sql.MAX), JSON.stringify(input.sectionIds))
    .query(`
      SELECT
        (SELECT COUNT(*) FROM vcm.SocioFormador WHERE socio_formador_id = @partnerId AND activo = 1) AS partners,
        (SELECT COUNT(*) FROM vcm.Asignatura WHERE asignatura_id = @subjectId AND activa = 1) AS subjects,
        (SELECT COUNT(*) FROM OPENJSON(@campusIds) requested
          INNER JOIN vcm.Sede campus ON campus.sede_id = TRY_CONVERT(uniqueidentifier, requested.[value]) AND campus.activa = 1) AS campuses,
        (SELECT COUNT(*) FROM OPENJSON(@sectionIds) requested
          INNER JOIN vcm.Seccion section ON section.seccion_id = TRY_CONVERT(uniqueidentifier, requested.[value])
          WHERE section.asignatura_id = @subjectId AND section.activa = 1
            AND EXISTS (SELECT 1 FROM OPENJSON(@campusIds) selectedCampus WHERE TRY_CONVERT(uniqueidentifier, selectedCampus.[value]) = section.sede_id)
            AND (
              section.periodo_academico_id = (
                SELECT TOP (1) period.periodo_academico_id
                FROM vcm.CargaAcademica academicLoad
                INNER JOIN vcm.PeriodoAcademico period ON period.codigo = academicLoad.periodo
                WHERE academicLoad.estado = 'APLICADA'
                ORDER BY academicLoad.aplicado_en DESC, academicLoad.creado_en DESC
              )
              OR (@projectId IS NOT NULL AND EXISTS (
                SELECT 1 FROM vcm.ProyectoSeccion existing
                WHERE existing.proyecto_id = @projectId AND existing.seccion_id = section.seccion_id
              ))
            )) AS sections;
    `);
  const counts = references.recordset[0];
  if (counts.partners !== 1) throw new AppError(400, "INVALID_PARTNER", "El socio formador seleccionado no está disponible.");
  if (counts.subjects !== 1) throw new AppError(400, "INVALID_SUBJECT", "La asignatura seleccionada no está disponible.");
  if (counts.campuses !== input.campusIds.length) throw new AppError(400, "INVALID_CAMPUSES", "Una o más sedes seleccionadas no están disponibles.");
  if (counts.sections !== input.sectionIds.length) throw new AppError(400, "INVALID_SECTIONS", "Una o más secciones responsables no corresponden a la asignatura, las sedes o el período académico vigente.");
}

async function updateProjectStudentAssignment(publicCode, studentId, input, principal) {
  if (!UUID_PATTERN.test(String(studentId || ""))) {
    throw new AppError(400, "INVALID_STUDENT_ID", "El identificador del estudiante no es válido.");
  }
  return withTransaction(async (transaction) => {
    const project = await getTeacherProject(transaction, publicCode, principal, true);
    if (["FINALIZADO", "CANCELADO"].includes(project.status)) {
      throw new AppError(409, "PROJECT_NOT_EDITABLE", "El proyecto ya no permite modificar el estado de sus estudiantes.");
    }
    const section = await assertTeacherSectionAccess(transaction, project.id, input.sectionId, principal, true);
    const milestones = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .query(`
        SELECT numero AS number, estado AS status
        FROM vcm.HitoProyectoSeccion WITH (UPDLOCK, HOLDLOCK)
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero IN (1, 3);
      `);
    const milestoneOne = milestones.recordset.find((milestone) => milestone.number === 1);
    const milestoneThree = milestones.recordset.find((milestone) => milestone.number === 3);
    if (milestoneOne?.status !== "COMPLETADO") {
      throw new AppError(409, "MILESTONE_ONE_REQUIRED", "Completa primero el Hito 1 de la sección para editar estudiantes individualmente.");
    }
    if (milestoneThree?.status === "COMPLETADO") {
      throw new AppError(409, "SECTION_ALREADY_CLOSED", "La sección ya está cerrada y no permite modificar estudiantes.");
    }

    const roster = await queryTeacherRoster(transaction, project.id, principal, input.sectionId);
    const student = roster.find((item) => item.id === studentId);
    if (!student) {
      throw new AppError(404, "STUDENT_NOT_IN_ROSTER", "El estudiante no pertenece a la nómina vigente de esta sección.");
    }
    const previous = { status: student.assignmentStatus, teamName: student.teamName || null };

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .query(`
        DELETE FROM vcm.EquipoAlumno
        WHERE proyecto_id = @projectId AND alumno_id = @studentId;
      `);

    let teamName = null;
    if (input.status === "ASIGNADO") {
      teamName = `Equipo ${input.teamNumber}`;
      const teamResult = await requestFor(transaction)
        .input("projectId", sql.UniqueIdentifier, project.id)
        .input("sectionId", sql.UniqueIdentifier, input.sectionId)
        .input("name", sql.NVarChar(100), teamName)
        .query(`
          SELECT CONVERT(varchar(36), equipo_id) AS id
          FROM vcm.Equipo WITH (UPDLOCK, HOLDLOCK)
          WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND nombre = @name;
        `);
      let teamId = teamResult.recordset[0]?.id;
      if (!teamId) {
        const countResult = await requestFor(transaction)
          .input("projectId", sql.UniqueIdentifier, project.id)
          .input("sectionId", sql.UniqueIdentifier, input.sectionId)
          .query(`
            SELECT COUNT(*) AS total FROM vcm.Equipo WITH (UPDLOCK, HOLDLOCK)
            WHERE proyecto_id = @projectId AND seccion_id = @sectionId;
          `);
        if (countResult.recordset[0].total >= 20) {
          throw new AppError(409, "TEAM_LIMIT_REACHED", "La sección ya tiene el máximo de 20 equipos.");
        }
        const created = await requestFor(transaction)
          .input("projectId", sql.UniqueIdentifier, project.id)
          .input("sectionId", sql.UniqueIdentifier, input.sectionId)
          .input("name", sql.NVarChar(100), teamName)
          .input("actorId", sql.UniqueIdentifier, principal.id)
          .query(`
            INSERT INTO vcm.Equipo (proyecto_id, seccion_id, nombre, creado_por_usuario_id)
            OUTPUT CONVERT(varchar(36), inserted.equipo_id) AS id
            VALUES (@projectId, @sectionId, @name, @actorId);
          `);
        teamId = created.recordset[0].id;
      }
      await requestFor(transaction)
        .input("teamId", sql.UniqueIdentifier, teamId)
        .input("projectId", sql.UniqueIdentifier, project.id)
        .input("studentId", sql.UniqueIdentifier, studentId)
        .query(`
          INSERT INTO vcm.EquipoAlumno (equipo_id, alumno_id, proyecto_id)
          VALUES (@teamId, @studentId, @projectId);
        `);
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, input.sectionId)
      .input("studentId", sql.UniqueIdentifier, studentId)
      .input("status", sql.VarChar(20), input.status)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        MERGE vcm.ProyectoAlumnoEstado WITH (HOLDLOCK) AS target
        USING (SELECT @projectId AS projectId, @studentId AS studentId) AS source
          ON target.proyecto_id = source.projectId AND target.alumno_id = source.studentId
        WHEN MATCHED THEN UPDATE SET seccion_id = @sectionId, estado = @status,
          actualizado_por_usuario_id = @actorId, actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (proyecto_id, seccion_id, alumno_id, estado, actualizado_por_usuario_id)
          VALUES (@projectId, @sectionId, @studentId, @status, @actorId);

        DELETE team
        FROM vcm.Equipo team
        WHERE team.proyecto_id = @projectId AND team.seccion_id = @sectionId
          AND NOT EXISTS (
            SELECT 1 FROM vcm.EquipoAlumno membership WHERE membership.equipo_id = team.equipo_id
          );
      `);
    await writeAudit(transaction, principal, {
      action: "PROJECT_STUDENT_ASSIGNMENT_UPDATED", entity: "ProyectoAlumnoEstado", entityId: studentId,
      description: `Estado de un estudiante actualizado en la sección ${section.code} del proyecto ${publicCode}.`,
      data: {
        projectId: project.id, sectionId: input.sectionId,
        previousStatus: previous.status, previousTeam: previous.teamName,
        status: input.status, teamName,
      },
    });
    const updatedRoster = await queryTeacherRoster(transaction, project.id, principal, input.sectionId);
    return updatedRoster.find((item) => item.id === studentId);
  });
}

async function saveProjectProgress(publicCode, progress, principal) {
  await withTransaction(async (transaction) => {
    const project = await getTeacherProject(transaction, publicCode, principal, true);
    if (project.status !== "EN_EJECUCION") {
      throw new AppError(409, "PROJECT_NOT_IN_PROGRESS", "Debes completar el Hito 1 antes de registrar avances.");
    }
    const section = await assertTeacherSectionAccess(transaction, project.id, progress.sectionId, principal, true);

    const availability = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        SELECT milestoneOne.estado AS milestoneOneStatus,
          CONVERT(char(10), milestoneTwo.disponible_desde, 23) AS availableFrom,
          CASE WHEN milestoneTwo.disponible_desde IS NOT NULL
            AND milestoneTwo.disponible_desde <= CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific SA Standard Time')
            THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS available
        FROM vcm.HitoProyecto milestoneOne WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN vcm.HitoProyecto milestoneTwo
          ON milestoneTwo.proyecto_id = milestoneOne.proyecto_id AND milestoneTwo.numero = 2
        WHERE milestoneOne.proyecto_id = @projectId AND milestoneOne.numero = 1;
      `);
    const milestoneAvailability = availability.recordset[0];
    if (milestoneAvailability?.milestoneOneStatus !== "COMPLETADO") {
      throw new AppError(409, "PROJECT_MILESTONE_ONE_REQUIRED", "Todas las secciones deben completar el Hito 1 antes de iniciar el Hito 2.");
    }
    if (!milestoneAvailability.availableFrom) {
      throw new AppError(409, "MILESTONE_TWO_NOT_SCHEDULED", "Coordinación todavía no ha programado la apertura del Hito 2.");
    }
    if (!milestoneAvailability.available) {
      throw new AppError(409, "MILESTONE_TWO_NOT_OPEN", `El Hito 2 estará disponible desde el ${milestoneAvailability.availableFrom}.`, {
        availableFrom: milestoneAvailability.availableFrom,
      });
    }

    const sectionMilestones = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, progress.sectionId)
      .query(`
        SELECT numero AS number, estado AS status FROM vcm.HitoProyectoSeccion WITH (UPDLOCK, HOLDLOCK)
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero IN (1, 2);
      `);
    if (sectionMilestones.recordset.find((milestone) => milestone.number === 1)?.status !== "COMPLETADO") {
      throw new AppError(409, "SECTION_MILESTONE_ONE_REQUIRED", "Debes completar el Hito 1 de esta sección antes de registrar su avance.");
    }
    if (sectionMilestones.recordset.find((milestone) => milestone.number === 2)?.status === "COMPLETADO") {
      throw new AppError(409, "MILESTONE_REOPEN_REQUIRED", "Coordinación debe reabrir el Hito 2 antes de corregir este avance.");
    }

    const feedback = await assertSectionFeedbackReviewed(transaction, project.id, progress.sectionId, progress);
    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, progress.sectionId)
      .input("reviewId", sql.UniqueIdentifier, feedback.id)
      .input("advance", sql.NVarChar(sql.MAX), progress.advance)
      .input("conclusions", sql.NVarChar(sql.MAX), progress.conclusions)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        MERGE vcm.AvanceProyectoSeccion WITH (HOLDLOCK) AS target
        USING (SELECT @projectId AS projectId, @sectionId AS sectionId) AS source
          ON target.proyecto_id = source.projectId AND target.seccion_id = source.sectionId
        WHEN MATCHED THEN UPDATE SET
          avance_resultado = @advance,
          conclusiones = @conclusions,
          revision_socio_id = @reviewId,
          retroalimentacion_revisada_en = SYSUTCDATETIME(),
          registrado_por_usuario_id = @actorId,
          registrado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (
          proyecto_id, seccion_id, avance_resultado, conclusiones, registrado_por_usuario_id, revision_socio_id, retroalimentacion_revisada_en
        ) VALUES (
          @projectId, @sectionId, @advance, @conclusions, @actorId, @reviewId, SYSUTCDATETIME()
        );

        UPDATE vcm.HitoProyectoSeccion
        SET estado = 'COMPLETADO', completado_en = SYSUTCDATETIME(),
          completado_por_usuario_id = @actorId
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero = 2;
      `);
    await syncProjectMilestone(transaction, project.id, 2, principal.id);
    await writeAudit(transaction, principal, {
      action: "PROJECT_SECTION_PROGRESS_SAVED", entity: "Proyecto", entityId: project.id,
      description: `Hito 2 completado para la sección ${section.code} del proyecto ${publicCode}.`,
      data: { sectionId: progress.sectionId, reviewId: feedback.id, feedbackReviewed: true },
    });
  });

  const projects = await listProjects(principal);
  return { project: projects.find((project) => project.id === publicCode) };
}

async function closeProject(publicCode, sectionId, principal) {
  await withTransaction(async (transaction) => {
    const project = await getTeacherProject(transaction, publicCode, principal, true);
    if (project.status !== "EN_EJECUCION") {
      throw new AppError(409, "PROJECT_NOT_IN_PROGRESS", "La sección no está disponible para cierre.");
    }
    const section = await assertTeacherSectionAccess(transaction, project.id, sectionId, principal, true);

    const milestones = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, sectionId)
      .query(`
        SELECT numero AS number, estado AS status
        FROM vcm.HitoProyectoSeccion WITH (UPDLOCK, HOLDLOCK)
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero IN (2, 3);
      `);
    if (milestones.recordset.find((milestone) => milestone.number === 2)?.status !== "COMPLETADO") {
      throw new AppError(409, "MILESTONE_TWO_REQUIRED", "Debes completar el Hito 2 de esta sección antes de cerrarla.");
    }
    if (milestones.recordset.find((milestone) => milestone.number === 3)?.status === "COMPLETADO") {
      throw new AppError(409, "MILESTONE_REOPEN_REQUIRED", "Coordinación debe reabrir el Hito 3 antes de volver a cerrar esta sección.");
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionId", sql.UniqueIdentifier, sectionId)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        UPDATE vcm.HitoProyectoSeccion
        SET estado = 'COMPLETADO', completado_en = SYSUTCDATETIME(),
          completado_por_usuario_id = @actorId
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId AND numero = 3;
      `);
    await syncProjectMilestone(transaction, project.id, 3, principal.id);
    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        UPDATE project
        SET estado = 'FINALIZADO', cerrado_en = SYSUTCDATETIME(), actualizado_en = SYSUTCDATETIME()
        FROM vcm.Proyecto project
        WHERE project.proyecto_id = @projectId
          AND NOT EXISTS (
            SELECT 1 FROM vcm.HitoProyectoSeccion milestone
            WHERE milestone.proyecto_id = @projectId AND milestone.numero = 3
              AND milestone.estado <> 'COMPLETADO'
          );
      `);
    await writeAudit(transaction, principal, {
      action: "PROJECT_SECTION_CLOSED", entity: "Proyecto", entityId: project.id,
      description: `Hito 3 completado para la sección ${section.code} del proyecto ${publicCode}.`,
      data: { sectionId },
    });
  });

  const projects = await listProjects(principal);
  return { project: projects.find((project) => project.id === publicCode) };
}

async function createProject(input, principal) {
  const publicCode = await withTransaction(async (transaction) => {
    const actorId = principal.id;
    await validateProjectReferences(transaction, input);

    const prefix = `VCM-${PILOT_YEAR}-`;
    const sequence = await new sql.Request(transaction)
      .input("prefix", sql.VarChar(20), `${prefix}%`)
      .query(`SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(codigo_publico, 10, 10))), 0) + 1 AS nextNumber FROM vcm.Proyecto WITH (UPDLOCK, HOLDLOCK) WHERE codigo_publico LIKE @prefix;`);
    const code = `${prefix}${String(sequence.recordset[0].nextNumber).padStart(3, "0")}`;

    const created = await new sql.Request(transaction)
      .input("code", sql.VarChar(30), code)
      .input("name", sql.NVarChar(220), input.name)
      .input("partnerId", sql.UniqueIdentifier, input.partnerId)
      .input("subjectId", sql.UniqueIdentifier, input.subjectId)
      .input("description", sql.NVarChar(sql.MAX), input.description)
      .input("expectedResult", sql.NVarChar(sql.MAX), input.expectedResult)
      .input("actorId", sql.UniqueIdentifier, actorId)
      .query(`
        INSERT INTO vcm.Proyecto (codigo_publico, nombre, socio_formador_id, asignatura_id, descripcion, resultado_esperado, creado_por_usuario_id)
        OUTPUT CONVERT(varchar(36), inserted.proyecto_id) AS id
        VALUES (@code, @name, @partnerId, @subjectId, @description, @expectedResult, @actorId);
      `);
    const projectId = created.recordset[0].id;

    await new sql.Request(transaction)
      .input("projectId", sql.UniqueIdentifier, projectId)
      .input("campusIds", sql.NVarChar(sql.MAX), JSON.stringify(input.campusIds))
      .query(`INSERT INTO vcm.ProyectoSede (proyecto_id, sede_id) SELECT @projectId, TRY_CONVERT(uniqueidentifier, [value]) FROM OPENJSON(@campusIds);`);
    await new sql.Request(transaction)
      .input("projectId", sql.UniqueIdentifier, projectId)
      .input("sectionIds", sql.NVarChar(sql.MAX), JSON.stringify(input.sectionIds))
      .query(`
        INSERT INTO vcm.ProyectoSeccion (proyecto_id, seccion_id)
        SELECT @projectId, TRY_CONVERT(uniqueidentifier, requested.[value])
        FROM OPENJSON(@sectionIds) requested;
      `);
    await new sql.Request(transaction)
      .input("projectId", sql.UniqueIdentifier, projectId)
      .query(`
        INSERT INTO vcm.HitoProyecto (proyecto_id, numero)
        VALUES (@projectId, 1), (@projectId, 2), (@projectId, 3);

        INSERT INTO vcm.HitoProyectoSeccion (proyecto_id, seccion_id, numero)
        SELECT projectSection.proyecto_id, projectSection.seccion_id, milestone.numero
        FROM vcm.ProyectoSeccion projectSection
        CROSS JOIN (VALUES (1), (2), (3)) milestone(numero)
        WHERE projectSection.proyecto_id = @projectId;
      `);
    await writeAudit(transaction, principal, {
      action: "PROJECT_CREATED", entity: "Proyecto", entityId: projectId,
      description: `Proyecto ${code} creado.`,
      data: { code, subjectId: input.subjectId, campusCount: input.campusIds.length, responsibleSectionCount: input.sectionIds.length },
    });
    return code;
  });

  const projects = await listProjects(principal);
  return projects.find((project) => project.id === publicCode);
}

async function updateProject(publicCode, input, principal) {
  await withTransaction(async (transaction) => {
    const project = await getProject(transaction, publicCode, true);
    await validateProjectReferences(transaction, input, project.id);

    const currentResult = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        SELECT CONVERT(varchar(36), projectSection.seccion_id) AS id,
          CASE WHEN EXISTS (
            SELECT 1 FROM vcm.HitoProyectoSeccion milestone
            WHERE milestone.proyecto_id = projectSection.proyecto_id
              AND milestone.seccion_id = projectSection.seccion_id AND milestone.estado = 'COMPLETADO'
          ) OR EXISTS (
            SELECT 1 FROM vcm.Equipo team
            WHERE team.proyecto_id = projectSection.proyecto_id AND team.seccion_id = projectSection.seccion_id
          ) OR EXISTS (
            SELECT 1 FROM vcm.AvanceProyectoSeccion progress
            WHERE progress.proyecto_id = projectSection.proyecto_id AND progress.seccion_id = projectSection.seccion_id
          ) OR EXISTS (
            SELECT 1 FROM vcm.ArchivoProyecto fileRow
            WHERE fileRow.proyecto_id = projectSection.proyecto_id AND fileRow.seccion_id = projectSection.seccion_id
          ) OR EXISTS (
            SELECT 1 FROM vcm.ProyectoAlumnoEstado studentState
            WHERE studentState.proyecto_id = projectSection.proyecto_id AND studentState.seccion_id = projectSection.seccion_id
          ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS hasActivity
        FROM vcm.ProyectoSeccion projectSection
        WHERE projectSection.proyecto_id = @projectId;
      `);
    const nextSectionIds = new Set(input.sectionIds.map((id) => id.toLowerCase()));
    const currentSections = currentResult.recordset;
    const removedSections = currentSections.filter((section) => !nextSectionIds.has(section.id.toLowerCase()));
    const protectedSections = getProtectedRemovedSectionIds(currentSections, input.sectionIds);
    if (protectedSections.length) {
      throw new AppError(409, "PROJECT_SECTIONS_HAVE_ACTIVITY", "No puedes quitar secciones que ya tienen equipos, archivos, avances o hitos completados.", { sectionIds: protectedSections });
    }

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("name", sql.NVarChar(220), input.name)
      .input("partnerId", sql.UniqueIdentifier, input.partnerId)
      .input("subjectId", sql.UniqueIdentifier, input.subjectId)
      .input("description", sql.NVarChar(sql.MAX), input.description)
      .input("expectedResult", sql.NVarChar(sql.MAX), input.expectedResult)
      .query(`
        UPDATE vcm.Proyecto
        SET nombre = @name, socio_formador_id = @partnerId, asignatura_id = @subjectId,
          descripcion = @description, resultado_esperado = @expectedResult,
          actualizado_en = SYSUTCDATETIME()
        WHERE proyecto_id = @projectId;
      `);

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("sectionIds", sql.NVarChar(sql.MAX), JSON.stringify(input.sectionIds))
      .query(`
        DELETE projectSection
        FROM vcm.ProyectoSeccion projectSection
        WHERE projectSection.proyecto_id = @projectId
          AND NOT EXISTS (
            SELECT 1 FROM OPENJSON(@sectionIds) requested
            WHERE TRY_CONVERT(uniqueidentifier, requested.[value]) = projectSection.seccion_id
          );

        INSERT INTO vcm.ProyectoSeccion (proyecto_id, seccion_id)
        SELECT @projectId, TRY_CONVERT(uniqueidentifier, requested.[value])
        FROM OPENJSON(@sectionIds) requested
        WHERE NOT EXISTS (
          SELECT 1 FROM vcm.ProyectoSeccion existing
          WHERE existing.proyecto_id = @projectId
            AND existing.seccion_id = TRY_CONVERT(uniqueidentifier, requested.[value])
        );

        INSERT INTO vcm.HitoProyectoSeccion (proyecto_id, seccion_id, numero)
        SELECT projectSection.proyecto_id, projectSection.seccion_id, milestone.numero
        FROM vcm.ProyectoSeccion projectSection
        CROSS JOIN (VALUES (1), (2), (3)) milestone(numero)
        WHERE projectSection.proyecto_id = @projectId
          AND NOT EXISTS (
            SELECT 1 FROM vcm.HitoProyectoSeccion existing
            WHERE existing.proyecto_id = projectSection.proyecto_id
              AND existing.seccion_id = projectSection.seccion_id AND existing.numero = milestone.numero
          );
      `);

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .input("campusIds", sql.NVarChar(sql.MAX), JSON.stringify(input.campusIds))
      .query(`
        DELETE projectCampus
        FROM vcm.ProyectoSede projectCampus
        WHERE projectCampus.proyecto_id = @projectId
          AND NOT EXISTS (
            SELECT 1 FROM OPENJSON(@campusIds) requested
            WHERE TRY_CONVERT(uniqueidentifier, requested.[value]) = projectCampus.sede_id
          );

        INSERT INTO vcm.ProyectoSede (proyecto_id, sede_id)
        SELECT @projectId, TRY_CONVERT(uniqueidentifier, requested.[value])
        FROM OPENJSON(@campusIds) requested
        WHERE NOT EXISTS (
          SELECT 1 FROM vcm.ProyectoSede existing
          WHERE existing.proyecto_id = @projectId
            AND existing.sede_id = TRY_CONVERT(uniqueidentifier, requested.[value])
        );
      `);

    for (const number of [1, 2, 3]) {
      await syncProjectMilestone(transaction, project.id, number, principal.id);
    }
    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        UPDATE project
        SET estado = CASE
            WHEN project.estado = 'CANCELADO' THEN 'CANCELADO'
            WHEN NOT EXISTS (
              SELECT 1 FROM vcm.HitoProyectoSeccion milestone
              WHERE milestone.proyecto_id = @projectId AND milestone.numero = 3 AND milestone.estado <> 'COMPLETADO'
            ) THEN 'FINALIZADO'
            WHEN EXISTS (
              SELECT 1 FROM vcm.HitoProyectoSeccion milestone
              WHERE milestone.proyecto_id = @projectId AND milestone.estado = 'COMPLETADO'
            ) THEN 'EN_EJECUCION'
            ELSE 'PLANIFICADO' END,
          cerrado_en = CASE
            WHEN project.estado <> 'CANCELADO' AND NOT EXISTS (
              SELECT 1 FROM vcm.HitoProyectoSeccion milestone
              WHERE milestone.proyecto_id = @projectId AND milestone.numero = 3 AND milestone.estado <> 'COMPLETADO'
            ) THEN COALESCE(project.cerrado_en, SYSUTCDATETIME())
            WHEN project.estado <> 'CANCELADO' THEN NULL ELSE project.cerrado_en END,
          actualizado_en = SYSUTCDATETIME()
        FROM vcm.Proyecto project WHERE project.proyecto_id = @projectId;
      `);
    await writeAudit(transaction, principal, {
      action: "PROJECT_UPDATED", entity: "Proyecto", entityId: project.id,
      description: `Proyecto ${publicCode} actualizado por administración.`,
      data: {
        subjectId: input.subjectId,
        campusIds: input.campusIds,
        sectionIds: input.sectionIds,
        removedSectionIds: removedSections.map((section) => section.id),
      },
    });
  });

  const projects = await listProjects(principal);
  return projects.find((project) => project.id === publicCode);
}

async function deleteProject(publicCode, principal) {
  const deleted = await withTransaction(async (transaction) => {
    const project = await getProject(transaction, publicCode, true);
    const files = await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        SELECT clave_almacenamiento AS storageKey
        FROM vcm.ArchivoProyecto WITH (UPDLOCK, HOLDLOCK)
        WHERE proyecto_id = @projectId;
      `);

    await writeAudit(transaction, principal, {
      action: "PROJECT_DELETED", entity: "Proyecto", entityId: project.id,
      description: `Proyecto ${publicCode} eliminado definitivamente por administración.`,
      data: { code: publicCode, name: project.name, fileCount: files.recordset.length },
    });

    await requestFor(transaction)
      .input("projectId", sql.UniqueIdentifier, project.id)
      .query(`
        DELETE FROM vcm.EquipoAlumno WHERE proyecto_id = @projectId;
        DELETE FROM vcm.Proyecto WHERE proyecto_id = @projectId;
      `);

    return {
      id: publicCode,
      internalId: project.id,
      name: project.name,
      storageKeys: [...new Set(files.recordset.map((file) => file.storageKey).filter(Boolean))],
    };
  });

  const cleanupResults = await Promise.allSettled(deleted.storageKeys.map((storageKey) => deleteBlobIfExists(storageKey)));
  const failedStorageKeys = deleted.storageKeys.filter((_, index) => cleanupResults[index].status === "rejected");
  if (failedStorageKeys.length) {
    const pool = await getPool();
    await writeAudit(pool, principal, {
      action: "PROJECT_BLOB_CLEANUP_PENDING", entity: "Proyecto", entityId: deleted.internalId,
      description: `El proyecto ${publicCode} fue eliminado, pero ${failedStorageKeys.length} archivo(s) requieren limpieza posterior en Blob Storage.`,
      data: { code: publicCode, failedStorageKeys },
    }).catch(() => undefined);
  }

  return {
    id: deleted.id,
    name: deleted.name,
    deleted: true,
    storageCleaned: failedStorageKeys.length === 0,
    pendingFileCleanup: failedStorageKeys.length,
  };
}

module.exports = {
  addProjectStudent,
  closeProject,
  createProject,
  deleteProject,
  listProjectRoster,
  listProjects,
  reopenSectionMilestone,
  removeProjectStudent,
  saveProjectProgress,
  scheduleMilestoneTwo,
  startProject,
  updateProject,
  updateProjectStudentAssignment,
};
