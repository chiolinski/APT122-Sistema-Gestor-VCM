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

async function getIndicators(requestedPeriod) {
  const pool = await getPool();
  const period = await resolvePeriod(pool, requestedPeriod);
  if (!period) return buildIndicators({ period: null });

  const [participation, milestones] = await Promise.all([
    pool.request().input("period", sql.VarChar(20), period).query(PARTICIPATION_QUERY),
    pool.request().input("period", sql.VarChar(20), period).query(MILESTONE_FUNNEL_QUERY),
  ]);

  return buildIndicators({
    period,
    participation: participation.recordset[0],
    milestones: milestones.recordset,
  });
}

module.exports = { getIndicators };