const crypto = require("node:crypto");
const { sql, getPool, withTransaction } = require("../lib/db");
const { AppError } = require("../lib/http");
const { writeAudit } = require("../lib/audit");
const { REVIEW_LINK_DAYS, assertReviewHasFeedback } = require("../lib/partnerReviews");

function requireAdministrator(principal) {
  if (principal?.role !== "admin") throw new AppError(403, "ROLE_REQUIRED", "Sólo el administrador puede realizar el cierre masivo.");
}

function validatePeriod(period) {
  if (typeof period !== "string" || !/^\d{4}-[12]$/.test(period)) {
    throw new AppError(400, "INVALID_PERIOD", "Selecciona un período académico válido.");
  }
}

async function listBulkReviewPeriods(principal) {
  requireAdministrator(principal);
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT codigo AS code FROM vcm.PeriodoAcademico ORDER BY codigo DESC;
  `);
  return result.recordset;
}

async function readScope(connection, period, lock = false) {
  if (lock) {
    // Publication/internal closure acquire project locks before review locks.
    // Update locks remain compatible with public saves' context reads.
    await new sql.Request(connection).input("period", sql.VarChar(20), period).query(`
      SELECT p.proyecto_id FROM vcm.Proyecto p WITH (UPDLOCK, HOLDLOCK)
      WHERE EXISTS (SELECT 1 FROM vcm.ProyectoSeccion ps
        INNER JOIN vcm.Seccion s ON s.seccion_id = ps.seccion_id
        INNER JOIN vcm.PeriodoAcademico pa ON pa.periodo_academico_id = s.periodo_academico_id
        WHERE ps.proyecto_id = p.proyecto_id AND pa.codigo = @period)
      OR EXISTS (SELECT 1 FROM vcm.RevisionSocio r
        INNER JOIN vcm.Seccion s ON s.seccion_id = r.seccion_id
        INNER JOIN vcm.PeriodoAcademico pa ON pa.periodo_academico_id = s.periodo_academico_id
        WHERE r.proyecto_id = p.proyecto_id AND pa.codigo = @period)
      ORDER BY p.proyecto_id;
    `);
  }
  const result = await new sql.Request(connection).input("period", sql.VarChar(20), period).query(`
    SELECT CONVERT(varchar(36), r.revision_socio_id) AS id,
      p.codigo_publico AS projectCode, campus.nombre AS campusName,
      subject.codigo AS subjectCode, section.codigo AS sectionCode,
      r.equipos_json AS teamsJson,
      CONVERT(varchar(27), r.completado_en, 126) + 'Z' AS completedAt,
      r.cierre_interno AS closedInternally,
      CONVERT(varchar(36), r.cerrado_por_usuario_id) AS closedById,
      CONVERT(varchar(27), r.vence_en, 126) + 'Z' AS originalExpiresAt,
      CONVERT(varchar(27), CASE WHEN r.vence_en < DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en)
        THEN r.vence_en ELSE DATEADD(day, ${REVIEW_LINK_DAYS}, r.creado_en) END, 126) + 'Z' AS expiresAt,
      (SELECT CONVERT(varchar(36), e.equipo_id) AS teamId,
        e.fortalezas AS strengths, e.mejoras AS improvements, e.valoracion AS rating,
        CONVERT(varchar(27), e.revisado_en, 126) + 'Z' AS reviewedAt
        FROM vcm.EvaluacionSocioEquipo e WHERE e.revision_socio_id = r.revision_socio_id
        ORDER BY e.equipo_id FOR JSON PATH) AS evaluationsJson
    FROM vcm.RevisionSocio r ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
    INNER JOIN vcm.Seccion section ON section.seccion_id = r.seccion_id
    INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
    INNER JOIN vcm.Proyecto p ON p.proyecto_id = r.proyecto_id
    INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
    INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
    WHERE period.codigo = @period AND r.revocado_en IS NULL
    ORDER BY r.revision_socio_id;
  `);
  return result.recordset;
}

function prepareScope(rows, now) {
  return rows.filter((row) => !row.completedAt || Date.parse(row.expiresAt) > now).map((row) => {
    const teams = JSON.parse(row.teamsJson);
    const evaluations = JSON.parse(row.evaluationsJson);
    if (!Array.isArray(teams) || !Array.isArray(evaluations)) throw new AppError(409, "REVIEW_INVALID_EVALUATIONS", `Revisa los datos de la revisión ${row.id} antes del cierre masivo.`);
    if (!row.completedAt && evaluations.length) assertReviewHasFeedback(teams, evaluations);
    return { id: row.id, projectCode: row.projectCode, campusName: row.campusName,
      subjectCode: row.subjectCode, sectionCode: row.sectionCode, expiresAt: row.expiresAt,
      evaluatedCount: evaluations.length, totalTeams: teams.length,
      outcome: row.completedAt ? "alreadyCompleted" : evaluations.length ? "withFeedback" : "withoutFeedback" };
  });
}

function revisionHash(rows, period, principal, generatedAt) {
  return crypto.createHash("sha256").update(JSON.stringify([period, principal.id, generatedAt, rows])).digest("hex");
}

function summaryOf(records) {
  return {
    links: records.length,
    withFeedback: records.filter((r) => r.outcome === "withFeedback").length,
    withoutFeedback: records.filter((r) => r.outcome === "withoutFeedback").length,
    alreadyCompleted: records.filter((r) => r.outcome === "alreadyCompleted").length,
    evaluations: records.reduce((sum, r) => sum + r.evaluatedCount, 0),
  };
}

async function previewBulkReviewClosure(period, principal) {
  requireAdministrator(principal); validatePeriod(period);
  const rows = await readScope(await getPool(), period);
  const generatedAt = new Date().toISOString();
  const records = prepareScope(rows, Date.parse(generatedAt));
  return { period, generatedAt, revision: revisionHash(rows, period, principal, generatedAt),
    summary: summaryOf(records), records };
}

async function closeBulkPartnerReviews(input, principal) {
  requireAdministrator(principal);
  const { period, generatedAt, revision, confirmed, confirmation } = input || {};
  validatePeriod(period);
  if (confirmed !== true || confirmation !== period) throw new AppError(400, "BULK_CONFIRMATION_REQUIRED", "Confirma las dos advertencias antes de cerrar los enlaces.");
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)
    || typeof generatedAt !== "string" || !Number.isFinite(Date.parse(generatedAt))
    || Date.parse(generatedAt) > Date.now() + 60000 || Date.now() - Date.parse(generatedAt) > 15 * 60000) {
    throw new AppError(409, "BULK_PREVIEW_CHANGED", "La vista previa venció. Actualízala y confirma nuevamente.");
  }
  return withTransaction(async (transaction) => {
    const rows = await readScope(transaction, period, true);
    if (revisionHash(rows, period, principal, generatedAt) !== revision) {
      throw new AppError(409, "BULK_PREVIEW_CHANGED", "Las revisiones o sus respuestas cambiaron. Actualiza la vista previa y confirma nuevamente.");
    }
    // Use the preview's cutoff: links that expire while confirming still belong to this operation.
    const records = prepareScope(rows, Date.parse(generatedAt));
    if (!records.length) throw new AppError(409, "BULK_NOTHING_TO_CLOSE", "No hay enlaces que cerrar en este período.");
    const operationId = crypto.randomUUID();
    const result = await new sql.Request(transaction)
      .input("targets", sql.NVarChar(sql.MAX), JSON.stringify(records.map((r) => ({ id: r.id }))))
      .input("actorId", sql.UniqueIdentifier, principal.id).input("period", sql.VarChar(20), period).query(`
        DECLARE @closedAt datetime2(0) = SYSUTCDATETIME();
        -- datetime2(0) rounds to the nearest second; expire strictly in the past.
        DECLARE @expiredAt datetime2(0) = DATEADD(second, -1, @closedAt);
        UPDATE r SET
          vence_en = CASE WHEN r.vence_en > @expiredAt THEN @expiredAt ELSE r.vence_en END,
          cierre_interno = CASE WHEN r.completado_en IS NULL THEN 1 ELSE r.cierre_interno END,
          cerrado_por_usuario_id = CASE WHEN r.completado_en IS NULL THEN @actorId ELSE r.cerrado_por_usuario_id END,
          completado_en = COALESCE(r.completado_en, @closedAt)
        OUTPUT CONVERT(varchar(36), inserted.revision_socio_id) AS id,
          CONVERT(varchar(19), @closedAt, 126) + 'Z' AS closedAt
        FROM vcm.RevisionSocio r
        INNER JOIN OPENJSON(@targets) WITH (id uniqueidentifier '$.id') targets ON targets.id = r.revision_socio_id
        INNER JOIN vcm.Seccion s ON s.seccion_id = r.seccion_id
        INNER JOIN vcm.PeriodoAcademico pa ON pa.periodo_academico_id = s.periodo_academico_id
        WHERE pa.codigo = @period AND r.revocado_en IS NULL;
      `);
    if (result.recordset.length !== records.length) throw new AppError(409, "BULK_PREVIEW_CHANGED", "El alcance cambió. Actualiza la vista previa y confirma nuevamente.");
    const summary = summaryOf(records);
    const closedAt = result.recordset[0].closedAt;
    // Required audit shares the transaction: no closure can commit without its evidence.
    await writeAudit(transaction, principal, {
      action: "PARTNER_REVIEWS_BULK_CLOSED", entity: "PeriodoAcademico", entityId: period,
      description: `Cierre masivo manual ${period}: ${summary.links} enlaces; ${summary.withFeedback} revisiones con respuestas, ${summary.withoutFeedback} sin respuestas, ${summary.alreadyCompleted} ya finalizadas. Hito 2 sin cambios.`,
      data: { operationId, period, closedAt, summary, reviews: records },
    }, { required: true });
    return { operationId, period, closedAt, summary };
  });
}

module.exports = { listBulkReviewPeriods, previewBulkReviewClosure, closeBulkPartnerReviews };
