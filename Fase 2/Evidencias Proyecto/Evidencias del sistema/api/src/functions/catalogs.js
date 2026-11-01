const { app } = require("@azure/functions");
const { requireUser } = require("../lib/auth");
const { getPool } = require("../lib/db");
const { handleError, ok } = require("../lib/http");

app.http("academicCatalogs", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "academic-catalogs",
  handler: async (request, context) => {
    try {
      await requireUser(request);
      const pool = await getPool();
      const [campuses, schools, subjects, sections, students] = await Promise.all([
        pool.request().query("SELECT CONVERT(varchar(36), sede_id) AS id, codigo AS code, nombre AS name FROM vcm.Sede WHERE activa = 1 ORDER BY nombre;"),
        pool.request().query("SELECT CONVERT(varchar(36), escuela_id) AS id, nombre AS name FROM vcm.Escuela WHERE activa = 1 ORDER BY nombre;"),
        pool.request().query(`SELECT CONVERT(varchar(36), subject.asignatura_id) AS id, subject.codigo AS code,
          subject.nombre AS name, school.nombre AS schoolName
          FROM vcm.Asignatura subject
          LEFT JOIN vcm.Escuela school ON school.escuela_id = subject.escuela_id
          WHERE subject.activa = 1 ORDER BY subject.codigo;`),
        pool.request().query(`SELECT CONVERT(varchar(36), section.seccion_id) AS id, section.codigo AS code, section.jornada AS shift, section.jornada AS schedule, CONVERT(varchar(36), subject.asignatura_id) AS subjectId, subject.codigo AS subjectCode, CONVERT(varchar(36), campus.sede_id) AS campusId, campus.nombre AS campus, period.codigo AS period FROM vcm.Seccion section INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id WHERE section.activa = 1 AND section.periodo_academico_id = (SELECT TOP (1) latestPeriod.periodo_academico_id FROM vcm.CargaAcademica academicLoad INNER JOIN vcm.PeriodoAcademico latestPeriod ON latestPeriod.codigo = academicLoad.periodo WHERE academicLoad.estado = 'APLICADA' ORDER BY academicLoad.aplicado_en DESC, academicLoad.creado_en DESC) ORDER BY subject.codigo, campus.nombre, section.codigo;`),
        pool.request().query("SELECT COUNT(*) AS total FROM vcm.Alumno WHERE activo = 1;"),
      ]);
      return ok({ campuses: campuses.recordset, schools: schools.recordset, subjects: subjects.recordset, sections: sections.recordset, studentCount: students.recordset[0].total, source: "vcm_piloto_2026_local" });
    } catch (error) {
      return handleError(error, context);
    }
  },
});
