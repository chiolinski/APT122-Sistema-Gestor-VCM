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

const PROJECT_SECTIONS = `
  SELECT projectSection.proyecto_id, projectSection.seccion_id, project.asignatura_id, project.estado
  FROM vcm.ProyectoSeccion projectSection
  INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
  INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
  INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
  WHERE period.codigo = @period AND project.estado <> 'CANCELADO'
`;

const PROJECT_INDICATORS_QUERY = `
  WITH projectSections AS (
    SELECT proyecto_id, seccion_id, asignatura_id FROM (${PROJECT_SECTIONS}) ps
    WHERE estado IN ('EN_EJECUCION', 'FINALIZADO')
  ),
  participations AS (
    SELECT DISTINCT ps.proyecto_id, enrollment.alumno_id, studentStatus.estado
    FROM projectSections ps
    INNER JOIN vcm.Matricula enrollment
      ON enrollment.seccion_id = ps.seccion_id
      AND enrollment.asignatura_id = ps.asignatura_id
      AND enrollment.vigente = 1
    LEFT JOIN vcm.ProyectoAlumnoEstado studentStatus
      ON studentStatus.proyecto_id = ps.proyecto_id AND studentStatus.alumno_id = enrollment.alumno_id
  ),
  milestones AS (
    SELECT milestone.proyecto_id, milestone.numero
    FROM vcm.HitoProyectoSeccion milestone
    INNER JOIN projectSections ps ON ps.proyecto_id = milestone.proyecto_id AND ps.seccion_id = milestone.seccion_id
    WHERE milestone.estado = 'COMPLETADO'
  ),
  teams AS (
    SELECT team.proyecto_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM vcm.EntregaVideoEquipo delivery
        WHERE delivery.equipo_id = team.equipo_id
          AND delivery.revocado_en IS NULL
          AND delivery.blob_confirmado IS NOT NULL
      ) THEN 1 ELSE 0 END AS delivered
    FROM vcm.Equipo team
    INNER JOIN projectSections ps ON ps.proyecto_id = team.proyecto_id AND ps.seccion_id = team.seccion_id
    WHERE EXISTS (SELECT 1 FROM vcm.EquipoAlumno member WHERE member.equipo_id = team.equipo_id)
  ),
  reviews AS (
    SELECT review.proyecto_id, review.revision_socio_id,
      CASE WHEN review.completado_en IS NOT NULL AND review.cierre_interno = 0 THEN 1 ELSE 0 END AS answered
    FROM vcm.RevisionSocio review
    INNER JOIN projectSections ps ON ps.proyecto_id = review.proyecto_id AND ps.seccion_id = review.seccion_id
    WHERE review.revocado_en IS NULL
  ),
  evaluations AS (
    SELECT reviews.proyecto_id, CAST(evaluation.valoracion AS int) AS rating
    FROM vcm.EvaluacionSocioEquipo evaluation
    INNER JOIN reviews ON reviews.revision_socio_id = evaluation.revision_socio_id
  )
  SELECT project.codigo_publico AS code, project.nombre AS name, school.nombre AS school,
    (SELECT COUNT(*) FROM participations p WHERE p.proyecto_id = project.proyecto_id) AS participations,
    (SELECT COUNT(*) FROM participations p WHERE p.proyecto_id = project.proyecto_id AND p.estado = 'ASIGNADO') AS assigned,
    (SELECT COUNT(*) FROM participations p WHERE p.proyecto_id = project.proyecto_id AND p.estado = 'DESERTOR') AS dropped,
    (SELECT COUNT(*) FROM projectSections ps WHERE ps.proyecto_id = project.proyecto_id) AS sections,
    (SELECT COUNT(*) FROM milestones m WHERE m.proyecto_id = project.proyecto_id AND m.numero = 1) AS milestoneOne,
    (SELECT COUNT(*) FROM milestones m WHERE m.proyecto_id = project.proyecto_id AND m.numero = 2) AS milestoneTwo,
    (SELECT COUNT(*) FROM milestones m WHERE m.proyecto_id = project.proyecto_id AND m.numero = 3) AS closedSections,
    (SELECT COUNT(*) FROM teams t WHERE t.proyecto_id = project.proyecto_id) AS teams,
    (SELECT ISNULL(SUM(t.delivered), 0) FROM teams t WHERE t.proyecto_id = project.proyecto_id) AS videos,
    (SELECT COUNT(*) FROM reviews r WHERE r.proyecto_id = project.proyecto_id) AS reviewsSent,
    (SELECT ISNULL(SUM(r.answered), 0) FROM reviews r WHERE r.proyecto_id = project.proyecto_id) AS reviewsAnswered,
    (SELECT COUNT(*) FROM evaluations e WHERE e.proyecto_id = project.proyecto_id) AS evaluations,
    (SELECT ISNULL(SUM(e.rating), 0) FROM evaluations e WHERE e.proyecto_id = project.proyecto_id) AS ratingSum
  FROM vcm.Proyecto project
  INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = project.asignatura_id
  LEFT JOIN vcm.Escuela school ON school.escuela_id = subject.escuela_id
  WHERE EXISTS (SELECT 1 FROM projectSections ps WHERE ps.proyecto_id = project.proyecto_id)
  ORDER BY project.codigo_publico;
`;

const PROJECTS_BY_SCHOOL_QUERY = `
  WITH projects AS (SELECT DISTINCT proyecto_id, asignatura_id FROM (${PROJECT_SECTIONS}) ps)
  SELECT school.nombre AS school, COUNT(*) AS projects
  FROM projects
  INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = projects.asignatura_id
  LEFT JOIN vcm.Escuela school ON school.escuela_id = subject.escuela_id
  GROUP BY school.nombre
  ORDER BY COUNT(*) DESC, school.nombre;
`;

async function getIndicators(requestedPeriod) {
  const pool = await getPool();
  const period = await resolvePeriod(pool, requestedPeriod);
  if (!period) return buildIndicators({ period: null });

  const [projects, schools] = await Promise.all(
    [PROJECT_INDICATORS_QUERY, PROJECTS_BY_SCHOOL_QUERY]
      .map((query) => pool.request().input("period", sql.VarChar(20), period).query(query)),
  );

  return buildIndicators({ period, projects: projects.recordset, schools: schools.recordset });
}

module.exports = { getIndicators };
