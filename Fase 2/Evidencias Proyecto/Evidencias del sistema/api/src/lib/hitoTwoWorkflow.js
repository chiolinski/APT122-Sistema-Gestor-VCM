const { sql } = require("./db");
const { AppError } = require("./http");
const { validateSectionId } = require("./projectRoster");
const { REVIEW_LINK_DAYS, assertFinalReviewFeedback } = require("./partnerReviews");
const { resolvePartnerVideo } = require("./partnerVideos");

async function getHitoTwoAccess(connection, publicCode, sectionId, principal, lock = false) {
  validateSectionId(sectionId);
  const result = await new sql.Request(connection)
    .input("code", sql.VarChar(30), publicCode).input("sectionId", sql.UniqueIdentifier, sectionId)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase())
    .query(`
      SELECT CONVERT(varchar(36), p.proyecto_id) AS projectId, p.estado AS projectStatus,
        campus.nombre AS campusName, subject.nombre AS subjectName, section.codigo AS sectionCode,
        oneSection.estado AS milestoneOneStatus, twoSection.estado AS milestoneTwoStatus,
        oneGlobal.estado AS allMilestoneOneStatus,
        CASE WHEN twoGlobal.disponible_desde <= CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific SA Standard Time')
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS available,
        CONVERT(varchar(36), progress.revision_socio_id) AS closedReviewId,
        CONVERT(varchar(19), progress.retroalimentacion_revisada_en, 126) + 'Z' AS feedbackReviewedAt,
        CASE WHEN EXISTS (SELECT 1 FROM vcm.DocenteSeccion ds
          INNER JOIN vcm.Docente teacher ON teacher.docente_id = ds.docente_id AND teacher.activo = 1
          WHERE ds.seccion_id = section.seccion_id AND ds.vigente = 1
            AND (teacher.usuario_id = @userId OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)))
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS teacherAssigned
      FROM vcm.Proyecto p ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      INNER JOIN vcm.ProyectoSeccion ps ON ps.proyecto_id = p.proyecto_id AND ps.seccion_id = @sectionId
      INNER JOIN vcm.Seccion section ON section.seccion_id = ps.seccion_id AND section.activa = 1
      INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id AND period.codigo = '2026-2'
      INNER JOIN vcm.SocioFormador partner ON partner.socio_formador_id = p.socio_formador_id AND partner.activo = 1
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      LEFT JOIN vcm.HitoProyectoSeccion oneSection ON oneSection.proyecto_id = p.proyecto_id AND oneSection.seccion_id = section.seccion_id AND oneSection.numero = 1
      LEFT JOIN vcm.HitoProyectoSeccion twoSection ON twoSection.proyecto_id = p.proyecto_id AND twoSection.seccion_id = section.seccion_id AND twoSection.numero = 2
      LEFT JOIN vcm.HitoProyecto oneGlobal ON oneGlobal.proyecto_id = p.proyecto_id AND oneGlobal.numero = 1
      LEFT JOIN vcm.HitoProyecto twoGlobal ON twoGlobal.proyecto_id = p.proyecto_id AND twoGlobal.numero = 2
      LEFT JOIN vcm.AvanceProyectoSeccion progress ON progress.proyecto_id = p.proyecto_id AND progress.seccion_id = section.seccion_id
      WHERE p.codigo_publico = @code;
    `);
  const access = result.recordset[0];
  if (!access) throw new AppError(404, "HITO_TWO_SECTION_NOT_FOUND", "No se encontró una sección activa para este Hito 2.");
  if (!["admin", "coordinator"].includes(principal.role)
    && !(principal.role === "teacher" && principal.canTeach && access.teacherAssigned)) {
    throw new AppError(403, "SECTION_ACCESS_DENIED", "No tienes permiso para consultar esta sección.");
  }
  return access;
}

function assertHitoTwoOpen(access) {
  if (access.projectStatus !== "EN_EJECUCION" || access.milestoneTwoStatus === "COMPLETADO") {
    throw new AppError(409, "HITO_TWO_LOCKED", "El Hito 2 de esta sección no está abierto. Coordinación debe reabrirlo si requiere cambios.");
  }
  if (access.milestoneOneStatus !== "COMPLETADO" || access.allMilestoneOneStatus !== "COMPLETADO" || !access.available) {
    throw new AppError(409, "HITO_TWO_NOT_OPEN", "Primero completa el Hito 1 y espera la apertura del Hito 2 programada por coordinación.");
  }
}

async function getSectionTeams(connection, projectId, sectionId, lock = false) {
  const result = await new sql.Request(connection).input("projectId", sql.UniqueIdentifier, projectId)
    .input("sectionId", sql.UniqueIdentifier, sectionId).query(`
      SELECT CONVERT(varchar(36), equipo_id) AS id, nombre AS name, delivery.blob_confirmado AS videoBlobName,
        CASE WHEN delivery.entrega_video_equipo_id IS NOT NULL AND delivery.blob_confirmado IS NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS videoDeliveryPending
      FROM vcm.Equipo ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      OUTER APPLY (SELECT TOP (1) d.blob_confirmado, d.entrega_video_equipo_id FROM vcm.EntregaVideoEquipo d
        WHERE d.proyecto_id = vcm.Equipo.proyecto_id AND d.seccion_id = vcm.Equipo.seccion_id
          AND d.equipo_id = vcm.Equipo.equipo_id AND d.revocado_en IS NULL
        ORDER BY d.creado_en DESC, d.entrega_video_equipo_id DESC) delivery
      WHERE proyecto_id = @projectId AND seccion_id = @sectionId
        AND EXISTS (SELECT 1 FROM vcm.EquipoAlumno ea WHERE ea.equipo_id = vcm.Equipo.equipo_id)
      ORDER BY LEN(nombre), nombre;
    `);
  return result.recordset;
}

function samePublishedTeams(current, published) {
  return current.length > 0 && current.length === published.length && current.every((team) =>
    published.some((item) => item.id.toLowerCase() === team.id.toLowerCase() && item.name === team.name
      && (item.videoBlobName || null) === (team.videoBlobName || null)
      && Boolean(item.videoDeliveryPending) === Boolean(team.videoDeliveryPending)));
}

async function inspectSectionVideos(context, teams) {
  const results = new Array(teams.length);
  let next = 0;
  // Bound Azure requests even for a twenty-team section.
  await Promise.all(Array.from({ length: Math.min(4, teams.length) }, async () => {
    while (next < teams.length) {
      const index = next++;
      const team = teams[index];
      try {
        const video = await resolvePartnerVideo(context, team, { teams });
        results[index] = { id: team.id, name: team.name, status: video.status };
      } catch {
        results[index] = { id: team.id, name: team.name, status: "error" };
      }
    }
  }));
  return results;
}

async function prepareVideoDelivery(connection, publicCode, sectionId, principal) {
  const access = await getHitoTwoAccess(connection, publicCode, sectionId, principal);
  assertHitoTwoOpen(access);
  const teams = await getSectionTeams(connection, access.projectId, sectionId);
  if (!teams.length) throw new AppError(409, "REVIEW_WITHOUT_TEAMS", "Primero deben conformarse los equipos de esta sección.");
  const videos = await inspectSectionVideos(access, teams);
  if (videos.some((video) => video.status !== "available")) {
    throw new AppError(409, "HITO_TWO_VIDEOS_REQUIRED", "Todos los equipos deben tener su video disponible antes de registrar la entrega y solicitar la retroalimentación.");
  }
  return { access, teams };
}

async function getSectionFeedback(connection, projectId, sectionId, { lock = false, reviewId = null } = {}) {
  const result = await new sql.Request(connection).input("projectId", sql.UniqueIdentifier, projectId)
    .input("sectionId", sql.UniqueIdentifier, sectionId).input("reviewId", sql.UniqueIdentifier, reviewId).query(`
      SELECT TOP (1) CONVERT(varchar(36), r.revision_socio_id) AS id, r.equipos_json AS teamsJson,
        CONVERT(varchar(19), r.creado_en, 126) + 'Z' AS deliveredAt,
        CONVERT(varchar(19), CASE WHEN r.vence_en < DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en)
          THEN r.vence_en ELSE DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en) END, 126) + 'Z' AS expiresAt,
        CONVERT(varchar(19), r.completado_en, 126) + 'Z' AS completedAt,
        r.cierre_interno AS closedInternally,
        CONVERT(varchar(36), r.cerrado_por_usuario_id) AS closedById,
        closer.nombre AS closedByName
      FROM vcm.RevisionSocio r ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      INNER JOIN vcm.Proyecto p ON p.proyecto_id = r.proyecto_id
      LEFT JOIN vcm.Usuario closer ON closer.usuario_id = r.cerrado_por_usuario_id
      WHERE r.proyecto_id = @projectId AND r.seccion_id = @sectionId
        AND ((@reviewId IS NOT NULL AND r.revision_socio_id = @reviewId)
          OR (@reviewId IS NULL AND r.revocado_en IS NULL AND r.socio_formador_id = p.socio_formador_id))
      ORDER BY r.creado_en DESC, r.revision_socio_id DESC;
    `);
  if (!result.recordset[0]) return null;
  const { teamsJson, ...review } = result.recordset[0];
  const evaluations = await new sql.Request(connection).input("id", sql.UniqueIdentifier, review.id).query(`
    SELECT CONVERT(varchar(36), equipo_id) AS teamId, fortalezas AS strengths, mejoras AS improvements,
      valoracion AS rating, CONVERT(varchar(19), revisado_en, 126) + 'Z' AS reviewedAt
    FROM vcm.EvaluacionSocioEquipo WHERE revision_socio_id = @id;
  `);
  return { ...review, teams: JSON.parse(teamsJson), evaluations: evaluations.recordset };
}

async function assertSectionFeedbackReviewed(connection, projectId, sectionId, input) {
  if (input.feedbackReviewed !== true) throw new AppError(400, "FEEDBACK_ACK_REQUIRED", "Confirma que revisaste el resumen de la retroalimentación de tu sección.");
  const review = await getSectionFeedback(connection, projectId, sectionId, { lock: true });
  if (!review?.completedAt) throw new AppError(409, "FEEDBACK_NOT_COMPLETED", "La revisión del socio debe finalizar antes de cerrar el Hito 2, por el socio o mediante el cierre interno autorizado.");
  if (review.id.toLowerCase() !== String(input.reviewId || "").toLowerCase()) {
    throw new AppError(409, "FEEDBACK_CHANGED", "La revisión cambió. Actualiza y lee el resumen vigente antes de cerrar el Hito 2.");
  }
  const teams = await getSectionTeams(connection, projectId, sectionId, true);
  if (!samePublishedTeams(teams, review.teams)) throw new AppError(409, "REVIEW_TEAMS_CHANGED", "Los equipos cambiaron desde la entrega. Solicita una nueva revisión de los videos.");
  assertFinalReviewFeedback(review);
  return review;
}

module.exports = { getHitoTwoAccess, assertHitoTwoOpen, getSectionTeams, samePublishedTeams,
  inspectSectionVideos, prepareVideoDelivery, getSectionFeedback, assertSectionFeedbackReviewed };
