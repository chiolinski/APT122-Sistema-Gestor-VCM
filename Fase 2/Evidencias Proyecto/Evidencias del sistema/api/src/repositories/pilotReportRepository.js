const { sql, getPool } = require("../lib/db");
const { normalizePagination, validateReportDimension } = require("../lib/pilotReports");

const REPORT_QUERIES = {
  campuses: `
    SELECT campus.codigo AS code, campus.nombre AS name,
      COUNT(DISTINCT section.seccion_id) AS sections,
      COUNT(DISTINCT section.asignatura_id) AS subjects,
      COUNT(DISTINCT teacherAssignment.docente_id) AS teachers,
      COUNT(DISTINCT enrollment.alumno_id) AS students,
      COUNT(DISTINCT projectCampus.proyecto_id) AS projects
    FROM vcm.Sede campus
    LEFT JOIN vcm.Seccion section ON section.sede_id = campus.sede_id AND section.activa = 1
    LEFT JOIN vcm.DocenteSeccion teacherAssignment ON teacherAssignment.seccion_id = section.seccion_id AND teacherAssignment.vigente = 1
    LEFT JOIN vcm.Matricula enrollment ON enrollment.seccion_id = section.seccion_id AND enrollment.vigente = 1
    LEFT JOIN vcm.ProyectoSede projectCampus ON projectCampus.sede_id = campus.sede_id
    WHERE campus.activa = 1
    GROUP BY campus.codigo, campus.nombre
    ORDER BY campus.nombre;`,
  subjects: `
    SELECT subject.codigo AS code, subject.nombre AS name,
      COUNT(DISTINCT section.seccion_id) AS sections,
      COUNT(DISTINCT section.sede_id) AS campuses,
      COUNT(DISTINCT teacherAssignment.docente_id) AS teachers,
      COUNT(DISTINCT enrollment.alumno_id) AS students,
      COUNT(DISTINCT project.proyecto_id) AS projects
    FROM vcm.Asignatura subject
    LEFT JOIN vcm.Seccion section ON section.asignatura_id = subject.asignatura_id AND section.activa = 1
    LEFT JOIN vcm.DocenteSeccion teacherAssignment ON teacherAssignment.seccion_id = section.seccion_id AND teacherAssignment.vigente = 1
    LEFT JOIN vcm.Matricula enrollment ON enrollment.asignatura_id = subject.asignatura_id AND enrollment.vigente = 1
    LEFT JOIN vcm.Proyecto project ON project.asignatura_id = subject.asignatura_id
    WHERE subject.activa = 1
    GROUP BY subject.codigo, subject.nombre
    ORDER BY subject.codigo;`,
  sections: `
    SELECT period.codigo AS period, subject.codigo AS subjectCode, subject.nombre AS subjectName,
      campus.nombre AS campusName, section.codigo AS sectionCode, section.jornada AS shift,
      COUNT(DISTINCT teacherAssignment.docente_id) AS teachers,
      COUNT(DISTINCT enrollment.alumno_id) AS students,
      COUNT(DISTINCT projectSection.proyecto_id) AS projects,
      COUNT(DISTINCT team.equipo_id) AS teams
    FROM vcm.Seccion section
    INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
    INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
    INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
    LEFT JOIN vcm.DocenteSeccion teacherAssignment ON teacherAssignment.seccion_id = section.seccion_id AND teacherAssignment.vigente = 1
    LEFT JOIN vcm.Matricula enrollment ON enrollment.seccion_id = section.seccion_id AND enrollment.vigente = 1
    LEFT JOIN vcm.ProyectoSeccion projectSection ON projectSection.seccion_id = section.seccion_id
    LEFT JOIN vcm.Equipo team ON team.seccion_id = section.seccion_id
    WHERE section.activa = 1
    GROUP BY period.codigo, subject.codigo, subject.nombre, campus.nombre, section.codigo, section.jornada
    ORDER BY period.codigo DESC, subject.codigo, campus.nombre, section.codigo;`,
};

async function getPilotOverview() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM vcm.Sede WHERE activa = 1) AS campuses,
      (SELECT COUNT(*) FROM vcm.Asignatura WHERE activa = 1) AS subjects,
      (SELECT COUNT(*) FROM vcm.Seccion WHERE activa = 1) AS sections,
      (SELECT COUNT(*) FROM vcm.Alumno WHERE activo = 1) AS students,
      (SELECT COUNT(*) FROM vcm.Docente WHERE activo = 1) AS teachers,
      (SELECT COUNT(*) FROM vcm.Docente WHERE activo = 1 AND usuario_id IS NOT NULL) AS linkedTeachers,
      (SELECT COUNT(*) FROM vcm.Usuario WHERE activo = 1) AS activeUsers,
      (SELECT COUNT(*) FROM vcm.Usuario WHERE activo = 1 AND rol = 'COORDINATOR') AS coordinators,
      (SELECT COUNT(*) FROM vcm.SocioFormador WHERE activo = 1) AS partners,
      (SELECT COUNT(*) FROM vcm.Proyecto) AS projects,
      (SELECT COUNT(*) FROM vcm.Proyecto WHERE estado = 'EN_EJECUCION') AS activeProjects,
      (SELECT COUNT(*) FROM vcm.Proyecto WHERE estado = 'FINALIZADO') AS finishedProjects,
      (SELECT COUNT(*) FROM vcm.Equipo) AS teams,
      CASE WHEN OBJECT_ID('vcm.Auditoria', 'U') IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS auditEnabled,
      (SELECT TOP (1) aplicado_en FROM vcm.CargaAcademica WHERE estado = 'APLICADA' ORDER BY aplicado_en DESC, creado_en DESC) AS lastAcademicLoadAt,
      (SELECT TOP (1) nombre_archivo FROM vcm.CargaAcademica WHERE estado = 'APLICADA' ORDER BY aplicado_en DESC, creado_en DESC) AS lastAcademicLoadFile;
  `);
  const metrics = result.recordset[0];
  return {
    metrics,
    readiness: [
      { key: "academic", label: "Carga académica aplicada", ready: Boolean(metrics.lastAcademicLoadAt), detail: metrics.lastAcademicLoadFile || "No existe una carga aplicada" },
      { key: "catalogs", label: "Oferta académica disponible", ready: metrics.campuses > 0 && metrics.subjects > 0 && metrics.sections > 0, detail: `${metrics.campuses} sedes, ${metrics.subjects} asignaturas y ${metrics.sections} secciones` },
      { key: "students", label: "Nómina de estudiantes", ready: metrics.students > 0, detail: `${metrics.students} estudiantes activos` },
      { key: "coordinators", label: "Coordinación habilitada", ready: metrics.coordinators > 0, detail: `${metrics.coordinators} cuentas activas` },
      { key: "teachers", label: "Docentes vinculados", ready: metrics.linkedTeachers > 0 && metrics.linkedTeachers === metrics.teachers, detail: `${metrics.linkedTeachers} de ${metrics.teachers} docentes con cuenta vinculada` },
      { key: "projects", label: "Propuestas para validación", ready: metrics.projects > 0, detail: `${metrics.projects} proyectos creados` },
      { key: "audit", label: "Bitácora de auditoría", ready: Boolean(metrics.auditEnabled), detail: metrics.auditEnabled ? "Registro de cambios habilitado" : "Ejecuta la migración 005" },
    ],
  };
}

async function getPilotReport(dimension) {
  const safeDimension = validateReportDimension(dimension);
  const pool = await getPool();
  const result = await pool.request().query(REPORT_QUERIES[safeDimension]);
  return { dimension: safeDimension, generatedAt: new Date().toISOString(), records: result.recordset };
}

async function listAuditEvents(query = "", page = 1, pageSize = 25) {
  const pagination = normalizePagination(page, pageSize);
  const pool = await getPool();
  const availability = await pool.request().query("SELECT CASE WHEN OBJECT_ID('vcm.Auditoria', 'U') IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS enabled;");
  if (!availability.recordset[0].enabled) return { records: [], total: 0, ...pagination, enabled: false };
  const result = await pool.request()
    .input("pattern", sql.NVarChar(340), `%${String(query || "").trim().slice(0, 300)}%`)
    .input("offset", sql.Int, (pagination.page - 1) * pagination.pageSize)
    .input("pageSize", sql.Int, pagination.pageSize)
    .query(`
      SELECT COUNT(*) OVER() AS filteredTotal, CONVERT(varchar(30), auditoria_id) AS id,
        usuario_correo AS actorEmail, accion AS action, entidad AS entity,
        entidad_id AS entityId, descripcion AS description, datos AS data,
        creado_en AS createdAt
      FROM vcm.Auditoria
      WHERE usuario_correo LIKE @pattern OR accion LIKE @pattern OR entidad LIKE @pattern OR descripcion LIKE @pattern
      ORDER BY creado_en DESC, auditoria_id DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
    `);
  const records = result.recordset.map((record) => {
    const output = { ...record, data: record.data ? JSON.parse(record.data) : null };
    delete output.filteredTotal;
    return output;
  });
  return { records, total: result.recordset[0]?.filteredTotal || 0, ...pagination, enabled: true };
}

module.exports = { getPilotOverview, getPilotReport, listAuditEvents };
