const { buildCoordinationMonitoring, normalizeMonitoringFilters } = require("../lib/coordinationMonitoring");
const { writeAudit } = require("../lib/audit");
const { getPool } = require("../lib/db");

async function listCoordinationMonitoring(filters = {}) {
  const normalizedFilters = normalizeMonitoringFilters(filters);
  const pool = await getPool();
  const [projectsResult, sectionsResult, teachersResult, studentsResult, reviewsResult] = await Promise.all([
    pool.request().query(`
      SELECT CONVERT(varchar(36), project.proyecto_id) AS databaseId,
        project.codigo_publico AS id, project.nombre AS name, project.estado AS status,
        CONVERT(varchar(36), project.socio_formador_id) AS partnerId,
        subject.codigo AS subjectCode, subject.nombre AS subjectName, school.nombre AS schoolName,
        CONVERT(char(10), project.fecha_inicio, 23) AS startDate,
        CONVERT(char(10), project.fecha_termino, 23) AS endDate,
        CONVERT(char(10), milestoneTwo.disponible_desde, 23) AS availableFrom
      FROM vcm.Proyecto project
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = project.asignatura_id
      LEFT JOIN vcm.Escuela school ON school.escuela_id = subject.escuela_id
      LEFT JOIN vcm.HitoProyecto milestoneTwo
        ON milestoneTwo.proyecto_id = project.proyecto_id AND milestoneTwo.numero = 2
      ORDER BY project.creado_en DESC;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), projectSection.proyecto_id) AS projectId,
        CONVERT(varchar(36), section.seccion_id) AS id,
        section.codigo AS code, section.jornada AS shift, campus.nombre AS campusName, period.codigo AS periodCode,
        studentSummary.total AS studentCount, teamSummary.total AS teamCount,
        teamSummary.assignedStudents AS assignedStudentCount,
        milestoneOne.estado AS hito1Status, CONVERT(varchar(33), milestoneOne.completado_en, 127) AS hito1CompletedAt,
        milestoneTwo.estado AS hito2Status, CONVERT(varchar(33), milestoneTwo.completado_en, 127) AS hito2CompletedAt,
        milestoneThree.estado AS hito3Status, CONVERT(varchar(33), milestoneThree.completado_en, 127) AS hito3CompletedAt
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
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
    pool.request().query(`
      SELECT CONVERT(varchar(36), ps.proyecto_id) AS projectId,
        CONVERT(varchar(36), ps.seccion_id) AS sectionId,
        CONVERT(varchar(36), student.alumno_id) AS studentId,
        CONVERT(varchar(36), team.equipo_id) AS teamId,
        CAST(CASE WHEN delivery.confirmed = 1 THEN 1 ELSE 0 END AS bit) AS videoDelivered,
        COALESCE(studentStatus.estado, CASE WHEN team.equipo_id IS NULL THEN 'SIN_EQUIPO' ELSE 'ASIGNADO' END) AS assignmentStatus
      FROM vcm.ProyectoSeccion ps
      INNER JOIN vcm.Proyecto p ON p.proyecto_id = ps.proyecto_id
      INNER JOIN vcm.Matricula enrollment ON enrollment.seccion_id = ps.seccion_id
        AND enrollment.asignatura_id = p.asignatura_id AND enrollment.vigente = 1
      INNER JOIN vcm.Alumno student ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
      LEFT JOIN vcm.EquipoAlumno membership ON membership.proyecto_id = ps.proyecto_id AND membership.alumno_id = student.alumno_id
      LEFT JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id AND team.seccion_id = ps.seccion_id
      OUTER APPLY (
        SELECT TOP (1) 1 AS confirmed
        FROM vcm.EntregaVideoEquipo video
        WHERE video.proyecto_id = ps.proyecto_id AND video.seccion_id = ps.seccion_id
          AND video.equipo_id = team.equipo_id AND video.revocado_en IS NULL
          AND video.blob_confirmado IS NOT NULL AND video.entregado_en IS NOT NULL
      ) delivery
      LEFT JOIN vcm.ProyectoAlumnoEstado studentStatus ON studentStatus.proyecto_id = ps.proyecto_id
        AND studentStatus.seccion_id = ps.seccion_id AND studentStatus.alumno_id = student.alumno_id;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), ps.proyecto_id) AS projectId,
        CONVERT(varchar(36), ps.seccion_id) AS sectionId,
        CONVERT(varchar(36), review.revision_socio_id) AS reviewId,
        CONVERT(varchar(36), review.socio_formador_id) AS partnerId,
        review.revocado_en AS revoked,
        CAST(CASE WHEN review.completado_en IS NOT NULL AND review.cierre_interno = 0 THEN 1 ELSE 0 END AS bit) AS completedByPartner,
        CASE WHEN progress.revision_socio_id = review.revision_socio_id AND milestone.estado = 'COMPLETADO'
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS usedForClosure,
        CONVERT(varchar(36), evaluation.equipo_id) AS teamId, evaluation.valoracion AS rating
      FROM vcm.ProyectoSeccion ps
      INNER JOIN vcm.Proyecto p ON p.proyecto_id = ps.proyecto_id
      LEFT JOIN vcm.HitoProyectoSeccion milestone ON milestone.proyecto_id = ps.proyecto_id
        AND milestone.seccion_id = ps.seccion_id AND milestone.numero = 2
      LEFT JOIN vcm.AvanceProyectoSeccion progress ON progress.proyecto_id = ps.proyecto_id AND progress.seccion_id = ps.seccion_id
      CROSS APPLY (
        SELECT TOP (1) r.* FROM vcm.RevisionSocio r
        WHERE r.proyecto_id = ps.proyecto_id AND r.seccion_id = ps.seccion_id
          AND ((milestone.estado = 'COMPLETADO' AND r.revision_socio_id = progress.revision_socio_id)
            OR (COALESCE(milestone.estado, 'PENDIENTE') <> 'COMPLETADO'
              AND r.revocado_en IS NULL AND r.socio_formador_id = p.socio_formador_id))
        ORDER BY r.creado_en DESC, r.revision_socio_id DESC
      ) review
      LEFT JOIN vcm.EvaluacionSocioEquipo evaluation ON evaluation.revision_socio_id = review.revision_socio_id
        AND EXISTS (SELECT 1 FROM OPENJSON(review.equipos_json) WITH (id uniqueidentifier '$.id') published
          WHERE published.id = evaluation.equipo_id);
    `),
  ]);

  return buildCoordinationMonitoring({
    projectRows: projectsResult.recordset,
    sectionRows: sectionsResult.recordset,
    teacherRows: teachersResult.recordset,
    studentRows: studentsResult.recordset,
    reviewRows: reviewsResult.recordset,
  }, undefined, normalizedFilters);
}

async function getCoordinationExportData(filters) {
  const report = await listCoordinationMonitoring(filters);
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
