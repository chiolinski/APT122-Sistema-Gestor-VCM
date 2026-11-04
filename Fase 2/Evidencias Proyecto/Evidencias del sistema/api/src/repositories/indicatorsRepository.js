const { sql, getPool } = require("../lib/db");
const { buildIndicators } = require("../lib/indicators");

async function resolvePeriod(pool, requestedPeriod) {
  if (requestedPeriod) return requestedPeriod;
  const result = await pool.request().query(`
    SELECT TOP (1) codigo AS code
    FROM vcm.PeriodoAcademico
    WHERE activo = 1
    ORDER BY codigo DESC;
  `);
  return result.recordset[0]?.code || null;
}

// M1: estudiantes de secciones vinculadas a proyectos que siguen cursando (sin desertores)
// y cuántos de ellos están asignados a un equipo.
const PARTICIPATION_QUERY = `
  WITH projectSections AS (
    SELECT projectSection.proyecto_id, projectSection.seccion_id, project.asignatura_id
    FROM vcm.ProyectoSeccion projectSection
    INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
    INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
    INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
    WHERE period.codigo = @period AND project.estado <> 'CANCELADO'
  ),
  enrolled AS (
    SELECT DISTINCT enrollment.alumno_id
    FROM projectSections ps
    INNER JOIN vcm.Matricula enrollment
      ON enrollment.seccion_id = ps.seccion_id
      AND enrollment.asignatura_id = ps.asignatura_id
      AND enrollment.vigente = 1
    WHERE NOT EXISTS (
      SELECT 1 FROM vcm.ProyectoAlumnoEstado dropout
      WHERE dropout.proyecto_id = ps.proyecto_id
        AND dropout.alumno_id = enrollment.alumno_id
        AND dropout.estado = 'DESERTOR'
    )
  ),
  assigned AS (
    SELECT DISTINCT studentStatus.alumno_id
    FROM vcm.ProyectoAlumnoEstado studentStatus
    INNER JOIN projectSections ps
      ON ps.proyecto_id = studentStatus.proyecto_id AND ps.seccion_id = studentStatus.seccion_id
    WHERE studentStatus.estado = 'ASIGNADO'
  )
  SELECT
    (SELECT COUNT(*) FROM enrolled) AS enrolled,
    (SELECT COUNT(*) FROM assigned WHERE alumno_id IN (SELECT alumno_id FROM enrolled)) AS assigned;
`;

// M4: por cada hito, cuántas secciones de proyecto lo tienen completado.
const MILESTONE_FUNNEL_QUERY = `
  SELECT milestone.numero AS milestone,
    COUNT(*) AS total,
    SUM(CASE WHEN milestone.estado = 'COMPLETADO' THEN 1 ELSE 0 END) AS completed
  FROM vcm.HitoProyectoSeccion milestone
  INNER JOIN vcm.Proyecto project ON project.proyecto_id = milestone.proyecto_id
  INNER JOIN vcm.Seccion section ON section.seccion_id = milestone.seccion_id
  INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
  WHERE period.codigo = @period AND project.estado <> 'CANCELADO'
  GROUP BY milestone.numero;
`;

const PROJECT_SECTIONS = `
  SELECT projectSection.proyecto_id, projectSection.seccion_id, project.asignatura_id
  FROM vcm.ProyectoSeccion projectSection
  INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
  INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
  INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
  WHERE period.codigo = @period AND project.estado <> 'CANCELADO'
`;

const VIDEO_DELIVERY_QUERY = `
  WITH projectSections AS (${PROJECT_SECTIONS}),
  teams AS (
    SELECT team.equipo_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM vcm.EntregaVideoEquipo delivery
        WHERE delivery.equipo_id = team.equipo_id
          AND delivery.revocado_en IS NULL
          AND delivery.blob_confirmado IS NOT NULL
      ) THEN 1 ELSE 0 END AS delivered
    FROM vcm.Equipo team
    INNER JOIN projectSections ps ON ps.proyecto_id = team.proyecto_id AND ps.seccion_id = team.seccion_id
    WHERE EXISTS (SELECT 1 FROM vcm.EquipoAlumno member WHERE member.equipo_id = team.equipo_id)
  )
  SELECT COUNT(*) AS total, ISNULL(SUM(delivered), 0) AS delivered FROM teams;
`;

const DROPOUT_QUERY = `
  WITH projectSections AS (${PROJECT_SECTIONS}),
  students AS (
    SELECT DISTINCT enrollment.alumno_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM vcm.ProyectoAlumnoEstado dropout
        WHERE dropout.proyecto_id = ps.proyecto_id
          AND dropout.alumno_id = enrollment.alumno_id
          AND dropout.estado = 'DESERTOR'
      ) THEN 1 ELSE 0 END AS dropped
    FROM projectSections ps
    INNER JOIN vcm.Matricula enrollment
      ON enrollment.seccion_id = ps.seccion_id
      AND enrollment.asignatura_id = ps.asignatura_id
      AND enrollment.vigente = 1
  )
  SELECT COUNT(DISTINCT alumno_id) AS enrolled,
    COUNT(DISTINCT CASE WHEN dropped = 1 THEN alumno_id END) AS dropped
  FROM students;
`;

const ACTIVE_REVIEWS = `
  SELECT review.revision_socio_id, review.completado_en, review.cierre_interno
  FROM vcm.RevisionSocio review
  INNER JOIN vcm.Proyecto project ON project.proyecto_id = review.proyecto_id
  INNER JOIN vcm.Seccion section ON section.seccion_id = review.seccion_id
  INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
  WHERE period.codigo = @period AND project.estado <> 'CANCELADO' AND review.revocado_en IS NULL
`;

const PARTNER_RESPONSE_QUERY = `
  WITH reviews AS (${ACTIVE_REVIEWS})
  SELECT COUNT(*) AS sent,
    ISNULL(SUM(CASE WHEN completado_en IS NOT NULL AND cierre_interno = 0 THEN 1 ELSE 0 END), 0) AS answered
  FROM reviews;
`;

const PARTNER_RATING_QUERY = `
  WITH reviews AS (${ACTIVE_REVIEWS})
  SELECT COUNT(*) AS evaluations, ISNULL(SUM(CAST(evaluation.valoracion AS int)), 0) AS ratingSum
  FROM vcm.EvaluacionSocioEquipo evaluation
  INNER JOIN reviews ON reviews.revision_socio_id = evaluation.revision_socio_id;
`;

async function getIndicators(requestedPeriod) {
  const pool = await getPool();
  const period = await resolvePeriod(pool, requestedPeriod);
  if (!period) return buildIndicators({ period: null });

  const queries = [
    PARTICIPATION_QUERY, MILESTONE_FUNNEL_QUERY, VIDEO_DELIVERY_QUERY,
    DROPOUT_QUERY, PARTNER_RESPONSE_QUERY, PARTNER_RATING_QUERY,
  ];
  const [participation, milestones, videos, dropout, responses, ratings] = await Promise.all(
    queries.map((query) => pool.request().input("period", sql.VarChar(20), period).query(query)),
  );

  return buildIndicators({
    period,
    participation: participation.recordset[0],
    milestones: milestones.recordset,
    videos: videos.recordset[0],
    dropout: dropout.recordset[0],
    responses: responses.recordset[0],
    ratings: ratings.recordset[0],
  });
}

module.exports = { getIndicators };