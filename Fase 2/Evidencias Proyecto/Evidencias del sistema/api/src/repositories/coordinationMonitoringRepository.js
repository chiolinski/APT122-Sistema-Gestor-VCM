const { buildCoordinationMonitoring, filterMonitoringReport } = require("../lib/coordinationMonitoring");
const { writeAudit } = require("../lib/audit");
const { getPool } = require("../lib/db");

async function listCoordinationMonitoring() {
  const pool = await getPool();
  const [projectsResult, sectionsResult, teachersResult] = await Promise.all([
    pool.request().query(`
      SELECT CONVERT(varchar(36), project.proyecto_id) AS databaseId,
        project.codigo_publico AS id, project.nombre AS name, project.estado AS status,
        subject.codigo AS subjectCode, subject.nombre AS subjectName,
        CONVERT(char(10), project.fecha_inicio, 23) AS startDate,
        CONVERT(char(10), project.fecha_termino, 23) AS endDate,
        CONVERT(char(10), milestoneTwo.disponible_desde, 23) AS availableFrom
      FROM vcm.Proyecto project
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = project.asignatura_id
      LEFT JOIN vcm.HitoProyecto milestoneTwo
        ON milestoneTwo.proyecto_id = project.proyecto_id AND milestoneTwo.numero = 2
      ORDER BY project.creado_en DESC;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), projectSection.proyecto_id) AS projectId,
        CONVERT(varchar(36), section.seccion_id) AS id,
        section.codigo AS code, section.jornada AS shift, campus.nombre AS campusName,
        studentSummary.total AS studentCount, teamSummary.total AS teamCount,
        teamSummary.assignedStudents AS assignedStudentCount,
        milestoneOne.estado AS hito1Status, CONVERT(varchar(33), milestoneOne.completado_en, 127) AS hito1CompletedAt,
        milestoneTwo.estado AS hito2Status, CONVERT(varchar(33), milestoneTwo.completado_en, 127) AS hito2CompletedAt,
        milestoneThree.estado AS hito3Status, CONVERT(varchar(33), milestoneThree.completado_en, 127) AS hito3CompletedAt
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      LEFT JOIN vcm.HitoProyectoSeccion milestoneOne
        ON milestoneOne.proyecto_id = projectSection.proyecto_id AND milestoneOne.seccion_id = projectSection.seccion_id AND milestoneOne.numero = 1
      LEFT JOIN vcm.HitoProyectoSeccion milestoneTwo
        ON milestoneTwo.proyecto_id = projectSection.proyecto_id AND milestoneTwo.seccion_id = projectSection.seccion_id AND milestoneTwo.numero = 2
      LEFT JOIN vcm.HitoProyectoSeccion milestoneThree
        ON milestoneThree.proyecto_id = projectSection.proyecto_id AND milestoneThree.seccion_id = projectSection.seccion_id AND milestoneThree.numero = 3
      OUTER APPLY (
        SELECT COUNT(*) AS total
        FROM vcm.Matricula enrollment
        WHERE enrollment.seccion_id = projectSection.seccion_id AND enrollment.vigente = 1
      ) studentSummary
      OUTER APPLY (
        SELECT COUNT(DISTINCT team.equipo_id) AS total,
          COUNT(DISTINCT membership.alumno_id) AS assignedStudents
        FROM vcm.Equipo team
        LEFT JOIN vcm.EquipoAlumno membership ON membership.equipo_id = team.equipo_id
        WHERE team.proyecto_id = projectSection.proyecto_id AND team.seccion_id = projectSection.seccion_id
      ) teamSummary
      ORDER BY campus.nombre, section.codigo;
    `),
    pool.request().query(`
      SELECT DISTINCT CONVERT(varchar(36), projectSection.proyecto_id) AS projectId,
        CONVERT(varchar(36), projectSection.seccion_id) AS sectionId,
        CONVERT(varchar(36), teacher.docente_id) AS id, teacher.nombre AS name,
        COALESCE(usr.correo, teacher.correo) AS email,
        CASE WHEN usr.usuario_id IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS accountLinked
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.DocenteSeccion assignment
        ON assignment.seccion_id = projectSection.seccion_id AND assignment.vigente = 1
      INNER JOIN vcm.Docente teacher
        ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
      LEFT JOIN vcm.Usuario usr ON usr.usuario_id = teacher.usuario_id AND usr.activo = 1;
    `),
  ]);

  return buildCoordinationMonitoring({
    projectRows: projectsResult.recordset,
    sectionRows: sectionsResult.recordset,
    teacherRows: teachersResult.recordset,
  });
}

async function getCoordinationExportData(filters) {
  const report = filterMonitoringReport(await listCoordinationMonitoring(), filters);
  const selectedProjectIds = new Set(report.projects.map((project) => project.id));
  const pool = await getPool();
  const [studentsResult, partnersResult] = await Promise.all([
    selectedProjectIds.size ? pool.request().query(`
      SELECT project.codigo_publico AS projectId, project.nombre AS projectName,
        subject.codigo AS subjectCode, subject.nombre AS subjectName,
        campus.nombre AS campusName, CONVERT(varchar(36), section.seccion_id) AS sectionId,
        section.codigo AS sectionCode, section.jornada AS shift,
        CONVERT(varchar(36), student.alumno_id) AS studentId,
        student.identificador_externo AS sourceId, student.rut,
        student.nombre_completo AS studentName, student.correo AS studentEmail,
        team.nombre AS teamName,
        COALESCE(studentStatus.estado, CASE WHEN team.equipo_id IS NULL THEN 'SIN_EQUIPO' ELSE 'ASIGNADO' END) AS assignmentStatus
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.Matricula enrollment
        ON enrollment.seccion_id = section.seccion_id AND enrollment.vigente = 1
      INNER JOIN vcm.Alumno student
        ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
      LEFT JOIN vcm.EquipoAlumno membership
        ON membership.proyecto_id = project.proyecto_id AND membership.alumno_id = student.alumno_id
      LEFT JOIN vcm.Equipo team
        ON team.equipo_id = membership.equipo_id AND team.seccion_id = section.seccion_id
      LEFT JOIN vcm.ProyectoAlumnoEstado studentStatus
        ON studentStatus.proyecto_id = project.proyecto_id
        AND studentStatus.seccion_id = section.seccion_id
        AND studentStatus.alumno_id = student.alumno_id
      ORDER BY project.codigo_publico, campus.nombre, section.codigo, student.nombre_completo;
    `) : Promise.resolve({ recordset: [] }),
    pool.request().query(`
      SELECT project.codigo_publico AS projectId, project.nombre AS projectName,
        CONVERT(varchar(36), partner.socio_formador_id) AS id,
        partner.razon_social AS businessName, partner.rut AS taxId,
        partner.rubro AS industry, partner.contacto_nombre AS contactName,
        partner.contacto_correo AS contactEmail, partner.contacto_telefono AS phone
      FROM vcm.SocioFormador partner
      LEFT JOIN vcm.Proyecto project ON project.socio_formador_id = partner.socio_formador_id
      ORDER BY partner.razon_social, project.codigo_publico;
    `),
  ]);
  const students = studentsResult.recordset.filter((student) => selectedProjectIds.has(student.projectId));
  const partners = partnersResult.recordset.filter((partner) => !partner.projectId || selectedProjectIds.has(partner.projectId));

  return { report, students, partners };
}

async function recordCoordinationExport(principal, report, studentCount, partnerCount = 0) {
  const pool = await getPool();
  await writeAudit(pool, principal, {
    action: "MONITORING_EXPORTED",
    entity: "Seguimiento",
    entityId: null,
    description: `Seguimiento exportado a Excel con ${report.projects.length} proyectos, ${partnerCount} socios formadores y ${studentCount} alumnos.`,
    data: {
      filters: report.filters,
      projects: report.projects.length,
      partners: partnerCount,
      sections: report.summary.sections,
      students: studentCount,
    },
  });
}

module.exports = { getCoordinationExportData, listCoordinationMonitoring, recordCoordinationExport };
