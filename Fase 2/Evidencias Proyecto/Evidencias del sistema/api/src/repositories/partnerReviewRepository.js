const { sql, getPool, withTransaction } = require("../lib/db");
const { AppError } = require("../lib/http");
const { writeAudit } = require("../lib/audit");
const { validateSectionId, UUID_PATTERN } = require("../lib/projectRoster");
const { currentDateInChile } = require("../lib/coordinationMonitoring");
const { resolvePartnerVideo } = require("../lib/partnerVideos");
const { getConfig } = require("../lib/config");
const { REVIEW_LINK_DAYS, canCloseReview, assertReviewHasFeedback, isFinalReviewFeedback,
  assertReviewComplete, assertReviewTeam, assertReviewWritable, createReviewToken, hashReviewToken } = require("../lib/partnerReviews");
const { getHitoTwoAccess, assertHitoTwoOpen, getSectionTeams, samePublishedTeams, inspectSectionVideos, prepareVideoDelivery, getSectionFeedback } = require("../lib/hitoTwoWorkflow");

async function getReviewContext(connection, publicCode, sectionId, lock = false) {
  validateSectionId(sectionId);
  const result = await new sql.Request(connection)
    .input("code", sql.VarChar(30), publicCode)
    .input("sectionId", sql.UniqueIdentifier, sectionId)
    .query(`
      SELECT CONVERT(varchar(36), p.proyecto_id) AS projectId, p.nombre AS projectName,
        p.codigo_publico AS projectCode, CONVERT(varchar(36), p.socio_formador_id) AS partnerId,
        partner.razon_social AS partnerName, partner.contacto_nombre AS contactName,
        section.codigo AS sectionCode, campus.nombre AS campusName,
        subject.nombre AS subjectName, period.codigo AS period,
        (SELECT STRING_AGG(CAST(t.nombre AS nvarchar(max)), N', ')
          FROM vcm.DocenteSeccion ds INNER JOIN vcm.Docente t ON t.docente_id = ds.docente_id AND t.activo = 1
          WHERE ds.seccion_id = section.seccion_id AND ds.vigente = 1) AS teacherName
      FROM vcm.Proyecto p ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      INNER JOIN vcm.ProyectoSeccion ps ON ps.proyecto_id = p.proyecto_id AND ps.seccion_id = @sectionId
      INNER JOIN vcm.Seccion section ON section.seccion_id = ps.seccion_id AND section.activa = 1
      INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      INNER JOIN vcm.SocioFormador partner ON partner.socio_formador_id = p.socio_formador_id AND partner.activo = 1
      WHERE p.codigo_publico = @code AND period.codigo = '2026-2' AND p.estado <> 'CANCELADO';
    `);
  if (!result.recordset[0]) throw new AppError(404, "REVIEW_CONTEXT_NOT_FOUND", "No se encontró una sección activa de VcM 2026-2 para este proyecto.");
  return result.recordset[0];
}

async function getEvaluations(connection, reviewId) {
  const result = await new sql.Request(connection).input("id", sql.UniqueIdentifier, reviewId).query(`
    SELECT CONVERT(varchar(36), equipo_id) AS teamId, fortalezas AS strengths,
      mejoras AS improvements, valoracion AS rating,
      CONVERT(varchar(19), revisado_en, 126) + 'Z' AS reviewedAt
    FROM vcm.EvaluacionSocioEquipo WHERE revision_socio_id = @id;
  `);
  return result.recordset;
}

async function getInvitation(connection, token, lock = false) {
  const result = await new sql.Request(connection).input("hash", sql.Char(64), hashReviewToken(token)).query(`
    SELECT CONVERT(varchar(36), r.revision_socio_id) AS id, r.equipos_json AS teamsJson,
      CONVERT(varchar(19), r.completado_en, 126) + 'Z' AS completedAt,
      CONVERT(varchar(19), CASE WHEN r.vence_en < DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en)
        THEN r.vence_en ELSE DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en) END, 126) + 'Z' AS expiresAt,
      r.cierre_interno AS closedInternally,
      p.codigo_publico AS projectCode, CONVERT(varchar(36), r.seccion_id) AS sectionId
    FROM vcm.RevisionSocio r ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
    INNER JOIN vcm.Proyecto p ON p.proyecto_id = r.proyecto_id AND p.socio_formador_id = r.socio_formador_id
    INNER JOIN vcm.ProyectoSeccion ps ON ps.proyecto_id = r.proyecto_id AND ps.seccion_id = r.seccion_id
    WHERE r.token_hash = @hash AND r.revocado_en IS NULL AND r.vence_en > SYSUTCDATETIME()
      AND DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en) > SYSUTCDATETIME();
  `);
  if (!result.recordset[0]) throw new AppError(404, "REVIEW_UNAVAILABLE", "Este enlace venció o ya no está disponible. Solicita un nuevo enlace a la coordinación.");
  const row = result.recordset[0];
  return { ...row, teams: JSON.parse(row.teamsJson) };
}

async function getPartnerReview(token) {
  const pool = await getPool();
  const review = await getInvitation(pool, token);
  const context = await getReviewContext(pool, review.projectCode, review.sectionId);
  const evaluations = await getEvaluations(pool, review.id);
  // Sólo se exponen los datos necesarios para revisar; nunca la nómina ni contactos privados.
  const { projectName, projectCode, partnerName, contactName, sectionCode, campusName, subjectName, period, teacherName } = context;
  return { id: review.id, projectName, projectCode, partnerName, contactName, sectionCode, campusName, subjectName, period, teacherName,
    teams: review.teams, evaluations, completedAt: review.completedAt, closedInternally: Boolean(review.closedInternally),
    expiresAt: review.expiresAt, reviewDate: currentDateInChile() };
}

async function getPartnerReviewVideo(token, teamId) {
  const pool = await getPool();
  const review = await getInvitation(pool, token);
  const context = await getReviewContext(pool, review.projectCode, review.sectionId);
  assertReviewTeam(review.teams, teamId);
  const team = review.teams.find((item) => item.id.toLowerCase() === teamId.toLowerCase());
  return resolvePartnerVideo(context, team, { teams: review.teams, reviewExpiresAt: review.expiresAt });
}

async function createPartnerReview(publicCode, sectionId, principal) {
  const delivery = await prepareVideoDelivery(await getPool(), publicCode, sectionId, principal);
  return withTransaction(async (transaction) => {
    const context = await getReviewContext(transaction, publicCode, sectionId, true);
    assertHitoTwoOpen(await getHitoTwoAccess(transaction, publicCode, sectionId, principal, true));
    const currentTeams = await getSectionTeams(transaction, context.projectId, sectionId, true);
    if (!samePublishedTeams(currentTeams, delivery.teams)) throw new AppError(409, "REVIEW_TEAMS_CHANGED", "Los equipos o sus videos cambiaron. Actualiza antes de registrar la entrega.");
    const token = createReviewToken();
    const teams = currentTeams.map((team) => ({ id: team.id, name: team.name, videoBlobName: team.videoBlobName || null, videoUrl: null }));
    const inserted = await new sql.Request(transaction)
      .input("projectId", sql.UniqueIdentifier, context.projectId).input("sectionId", sql.UniqueIdentifier, sectionId)
      .input("partnerId", sql.UniqueIdentifier, context.partnerId).input("actorId", sql.UniqueIdentifier, principal.id)
      .input("hash", sql.Char(64), hashReviewToken(token)).input("teams", sql.NVarChar(sql.MAX), JSON.stringify(teams))
      .query(`
        UPDATE vcm.RevisionSocio SET revocado_en = COALESCE(revocado_en, SYSUTCDATETIME())
        WHERE proyecto_id = @projectId AND seccion_id = @sectionId;
        INSERT INTO vcm.RevisionSocio (proyecto_id, seccion_id, socio_formador_id, token_hash, equipos_json, creado_por_usuario_id, vence_en)
        OUTPUT CONVERT(varchar(36), inserted.revision_socio_id) AS id, CONVERT(varchar(19), inserted.vence_en, 126) + 'Z' AS expiresAt
        VALUES (@projectId, @sectionId, @partnerId, @hash, @teams, @actorId, DATEADD(day, ${REVIEW_LINK_DAYS}, SYSUTCDATETIME()));
      `);
    await writeAudit(transaction, principal, { action: "PARTNER_REVIEW_CREATED", entity: "RevisionSocio", entityId: inserted.recordset[0].id,
      description: `Enlace de revisión creado para ${publicCode}.`, data: { sectionId, teamCount: teams.length, linkDays: REVIEW_LINK_DAYS } });
    return { ...inserted.recordset[0], token };
  });
}

async function getHitoTwoState(publicCode, sectionId, principal) {
  const pool = await getPool();
  const access = await getHitoTwoAccess(pool, publicCode, sectionId, principal);
  const closed = access.milestoneTwoStatus === "COMPLETADO";
  const review = closed && !access.closedReviewId ? null
    : await getSectionFeedback(pool, access.projectId, sectionId, { reviewId: closed ? access.closedReviewId : null });
  const teams = await getSectionTeams(pool, access.projectId, sectionId);
  const teamsChanged = Boolean(review && !samePublishedTeams(teams, review.teams));
  const complete = isFinalReviewFeedback(review);
  const videos = review && !teamsChanged ? review.teams.map((team) => ({ id: team.id, name: team.name, status: "available" }))
    : await inspectSectionVideos(access, teams);
  const ready = !closed && access.projectStatus === "EN_EJECUCION" && access.milestoneOneStatus === "COMPLETADO"
    && access.allMilestoneOneStatus === "COMPLETADO" && Boolean(access.available);
  return { sectionId, closed, feedbackReviewedAt: access.feedbackReviewedAt, teamsChanged, uploadEnabled: Boolean(getConfig().videoUploadEnabled),
    canPublish: ready && teams.length > 0 && videos.every((video) => video.status === "available"),
    canReceiveVideos: ready && !review, videos, feedbackReady: complete && !teamsChanged,
    canManageReviewClosure: ready && !teamsChanged && canCloseReview(principal, access.teacherAssigned)
      && Boolean(review && !review.completedAt),
    canCloseReview: ready && !teamsChanged && canCloseReview(principal, access.teacherAssigned)
      && Boolean(review && !review.completedAt && review.evaluations.length > 0),
    review: review ? { id: review.id, deliveredAt: review.deliveredAt, expiresAt: review.expiresAt, completedAt: review.completedAt,
      closedInternally: Boolean(review.closedInternally), closedByName: review.closedByName || null,
      evaluatedCount: review.evaluations.length, teams: review.teams.map(({ id, name }) => ({ id, name })),
      evaluations: complete ? review.evaluations : [] } : null };
}

async function listPartnerReviews(publicCode, principal) {
  const pool = await getPool();
  const result = await pool.request().input("code", sql.VarChar(30), publicCode)
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), String(principal.email || "").toLowerCase()).query(`
    SELECT CONVERT(varchar(36), r.revision_socio_id) AS id, CONVERT(varchar(36), r.seccion_id) AS sectionId,
      r.equipos_json AS teamsJson, CONVERT(varchar(19), r.creado_en, 126) + 'Z' AS createdAt,
      CONVERT(varchar(19), CASE WHEN r.vence_en < DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en)
        THEN r.vence_en ELSE DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en) END, 126) + 'Z' AS expiresAt,
      CONVERT(varchar(19), r.revocado_en, 126) + 'Z' AS revokedAt,
      CONVERT(varchar(19), r.completado_en, 126) + 'Z' AS completedAt,
      r.cierre_interno AS closedInternally, closer.nombre AS closedByName,
      CASE WHEN EXISTS (SELECT 1 FROM vcm.DocenteSeccion ds
        INNER JOIN vcm.Docente teacher ON teacher.docente_id = ds.docente_id AND teacher.activo = 1
        WHERE ds.seccion_id = r.seccion_id AND ds.vigente = 1
          AND (teacher.usuario_id = @userId OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)))
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS teacherAssigned,
      CASE WHEN r.revocado_en IS NULL AND p.socio_formador_id = r.socio_formador_id
        AND partner.activo = 1 AND section.activa = 1 AND ps.seccion_id IS NOT NULL
        AND p.estado = 'EN_EJECUCION'
        AND EXISTS (SELECT 1 FROM vcm.HitoProyectoSeccion h WHERE h.proyecto_id = r.proyecto_id
          AND h.seccion_id = r.seccion_id AND h.numero = 2 AND h.estado <> 'COMPLETADO')
        AND EXISTS (SELECT 1 FROM vcm.HitoProyectoSeccion h WHERE h.proyecto_id = r.proyecto_id
          AND h.seccion_id = r.seccion_id AND h.numero = 1 AND h.estado = 'COMPLETADO')
        AND EXISTS (SELECT 1 FROM vcm.HitoProyecto h WHERE h.proyecto_id = r.proyecto_id
          AND h.numero = 1 AND h.estado = 'COMPLETADO')
        AND EXISTS (SELECT 1 FROM vcm.HitoProyecto h WHERE h.proyecto_id = r.proyecto_id
          AND h.numero = 2 AND h.disponible_desde <= CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific SA Standard Time'))
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS closureContext,
      CASE WHEN r.revocado_en IS NULL AND r.vence_en > SYSUTCDATETIME()
        AND DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en) > SYSUTCDATETIME()
        AND p.socio_formador_id = r.socio_formador_id AND partner.activo = 1 AND section.activa = 1
        AND p.estado <> 'CANCELADO' AND ps.seccion_id IS NOT NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS active
    FROM vcm.RevisionSocio r INNER JOIN vcm.Proyecto p ON p.proyecto_id = r.proyecto_id
    INNER JOIN vcm.SocioFormador partner ON partner.socio_formador_id = r.socio_formador_id
    INNER JOIN vcm.Seccion section ON section.seccion_id = r.seccion_id
    LEFT JOIN vcm.Usuario closer ON closer.usuario_id = r.cerrado_por_usuario_id
    LEFT JOIN vcm.ProyectoSeccion ps ON ps.proyecto_id = r.proyecto_id AND ps.seccion_id = r.seccion_id
    WHERE p.codigo_publico = @code ORDER BY r.creado_en DESC, r.revision_socio_id DESC;
  `);
  const reviews = [];
  for (const { teamsJson, teacherAssigned, closureContext, ...row } of result.recordset) {
    const evaluations = await getEvaluations(pool, row.id);
    const canManageClosure = Boolean(closureContext && !row.completedAt && canCloseReview(principal, teacherAssigned));
    reviews.push({ ...row, teams: JSON.parse(teamsJson), evaluations,
      canManageClosure, canClose: canManageClosure && evaluations.length > 0 });
  }
  // El principal ya fue autorizado por el endpoint; se evita devolver hashes o tokens.
  return reviews;
}

async function closeSectionPartnerReview(publicCode, sectionId, reviewId, principal) {
  if (!canCloseReview(principal) && !(["teacher", "coordinator"].includes(principal?.role) && principal.canTeach)) {
    throw new AppError(403, "REVIEW_CLOSE_ACCESS_DENIED", "Sólo el docente de la sección o un coordinador CITT puede cerrar esta revisión.");
  }
  if (!UUID_PATTERN.test(String(reviewId || ""))) throw new AppError(400, "INVALID_REVIEW", "La revisión no es válida.");
  return withTransaction(async (transaction) => {
    const access = await getHitoTwoAccess(transaction, publicCode, sectionId, principal, true);
    if (!canCloseReview(principal, access.teacherAssigned)) {
      throw new AppError(403, "REVIEW_CLOSE_ACCESS_DENIED", "No tienes permiso para cerrar la revisión de esta sección.");
    }
    assertHitoTwoOpen(access);
    // No expiry filter: an expired invitation can still be closed internally.
    // The project/section locks serialize closure with publication and team changes.
    const review = await getSectionFeedback(transaction, access.projectId, sectionId, { lock: true });
    if (!review || review.id.toLowerCase() !== reviewId.toLowerCase()) {
      throw new AppError(409, "FEEDBACK_CHANGED", "La revisión cambió o fue revocada. Actualiza antes de cerrar.");
    }
    if (review.completedAt) return { id: review.id, completedAt: review.completedAt, closedInternally: Boolean(review.closedInternally) };
    const teams = await getSectionTeams(transaction, access.projectId, sectionId, true);
    if (!samePublishedTeams(teams, review.teams)) {
      throw new AppError(409, "REVIEW_TEAMS_CHANGED", "Los equipos o sus videos cambiaron. Solicita a coordinación una nueva revisión.");
    }
    assertReviewHasFeedback(review.teams, review.evaluations);
    const result = await new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, review.id).input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        UPDATE vcm.RevisionSocio
        SET completado_en = SYSUTCDATETIME(), cierre_interno = 1, cerrado_por_usuario_id = @actorId
        OUTPUT CONVERT(varchar(19), inserted.completado_en, 126) + 'Z' AS completedAt
        WHERE revision_socio_id = @id AND completado_en IS NULL AND revocado_en IS NULL;
      `);
    if (!result.recordset[0]) throw new AppError(409, "FEEDBACK_CHANGED", "La revisión cambió. Actualiza antes de cerrar.");
    const evaluatedCount = review.evaluations.length;
    await writeAudit(transaction, principal, {
      action: "PARTNER_REVIEW_CLOSED_INTERNALLY", entity: "RevisionSocio", entityId: review.id,
      description: `Revisión del socio cerrada para la sección ${access.sectionCode} del proyecto ${publicCode}: ${evaluatedCount} de ${review.teams.length} equipos evaluados.`,
      data: { projectId: access.projectId, sectionId, evaluatedCount, totalTeams: review.teams.length,
        unevaluatedCount: review.teams.length - evaluatedCount, partial: evaluatedCount < review.teams.length },
    }, { required: true });
    return { id: review.id, ...result.recordset[0], closedInternally: true, closedByName: principal.name || null,
      evaluatedCount, totalTeams: review.teams.length };
  });
}

async function revokePartnerReview(publicCode, reviewId, principal) {
  if (!UUID_PATTERN.test(String(reviewId || ""))) throw new AppError(400, "INVALID_REVIEW", "La revisión no es válida.");
  return withTransaction(async (transaction) => {
    const result = await new sql.Request(transaction).input("code", sql.VarChar(30), publicCode)
      .input("id", sql.UniqueIdentifier, reviewId).query(`
        UPDATE r SET revocado_en = COALESCE(r.revocado_en, SYSUTCDATETIME())
        FROM vcm.RevisionSocio r INNER JOIN vcm.Proyecto p ON p.proyecto_id = r.proyecto_id
        WHERE p.codigo_publico = @code AND r.revision_socio_id = @id;
      `);
    if (!result.rowsAffected[0]) throw new AppError(404, "REVIEW_NOT_FOUND", "No se encontró la revisión.");
    await writeAudit(transaction, principal, { action: "PARTNER_REVIEW_REVOKED", entity: "RevisionSocio", entityId: reviewId,
      description: `Enlace de revisión revocado para ${publicCode}.` });
    return { revoked: true };
  });
}

async function savePartnerEvaluation(token, teamId, input) {
  return withTransaction(async (transaction) => {
    const review = await getInvitation(transaction, token, true);
    await getReviewContext(transaction, review.projectCode, review.sectionId);
    assertReviewWritable(review);
    assertReviewTeam(review.teams, teamId);
    const result = await new sql.Request(transaction).input("id", sql.UniqueIdentifier, review.id)
      .input("teamId", sql.UniqueIdentifier, teamId).input("strengths", sql.NVarChar(4000), input.strengths)
      .input("improvements", sql.NVarChar(4000), input.improvements).input("rating", sql.TinyInt, input.rating).query(`
        MERGE vcm.EvaluacionSocioEquipo WITH (HOLDLOCK) AS target
        USING (SELECT @id AS reviewId, @teamId AS teamId) AS source
          ON target.revision_socio_id = source.reviewId AND target.equipo_id = source.teamId
        WHEN MATCHED THEN UPDATE SET fortalezas = @strengths, mejoras = @improvements, valoracion = @rating, revisado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (revision_socio_id, equipo_id, fortalezas, mejoras, valoracion)
          VALUES (@id, @teamId, @strengths, @improvements, @rating)
        OUTPUT CONVERT(varchar(36), inserted.equipo_id) AS teamId, inserted.fortalezas AS strengths,
          inserted.mejoras AS improvements, inserted.valoracion AS rating, CONVERT(varchar(19), inserted.revisado_en, 126) + 'Z' AS reviewedAt;
      `);
    return result.recordset[0];
  });
}

async function completePartnerReview(token) {
  return withTransaction(async (transaction) => {
    const review = await getInvitation(transaction, token, true);
    await getReviewContext(transaction, review.projectCode, review.sectionId);
    if (review.completedAt) return { completedAt: review.completedAt };
    assertReviewComplete(review.teams, await getEvaluations(transaction, review.id));
    const result = await new sql.Request(transaction).input("id", sql.UniqueIdentifier, review.id).query(`
      UPDATE vcm.RevisionSocio SET completado_en = SYSUTCDATETIME()
      OUTPUT CONVERT(varchar(19), inserted.completado_en, 126) + 'Z' AS completedAt WHERE revision_socio_id = @id;
    `);
    return result.recordset[0];
  });
}

module.exports = { closeSectionPartnerReview, completePartnerReview, createPartnerReview, getHitoTwoState, getPartnerReview, getPartnerReviewVideo, listPartnerReviews, revokePartnerReview, savePartnerEvaluation };
