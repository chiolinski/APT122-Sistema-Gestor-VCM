const { sql, getPool } = require("../lib/db");

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "es", { numeric: true, sensitivity: "base" });
}

function buildAccountProfile(principal, rows = []) {
  const campuses = new Map();
  const schools = new Map();
  const subjects = new Map();
  for (const row of rows) {
    if (!row.sectionId || !row.subjectId || !row.campusId) continue;

    if (!campuses.has(row.campusId)) {
      campuses.set(row.campusId, { id: row.campusId, code: row.campusCode, name: row.campusName });
    }
    if (row.schoolId && !schools.has(row.schoolId)) {
      schools.set(row.schoolId, { id: row.schoolId, name: row.schoolName });
    }

    if (!subjects.has(row.subjectId)) {
      subjects.set(row.subjectId, {
        id: row.subjectId,
        code: row.subjectCode,
        name: row.subjectName,
        school: row.schoolId ? { id: row.schoolId, name: row.schoolName } : null,
        sections: [],
      });
    }

    const subject = subjects.get(row.subjectId);
    if (!subject.sections.some((section) => section.id === row.sectionId)) {
      subject.sections.push({
        id: row.sectionId,
        code: row.sectionCode,
        shift: row.shift || null,
        period: row.period,
        campus: { id: row.campusId, code: row.campusCode, name: row.campusName },
      });
    }
  }

  const academicSubjects = [...subjects.values()]
    .map((subject) => ({
      ...subject,
      sections: subject.sections.sort((left, right) => (
        compareText(left.campus.name, right.campus.name) || compareText(left.code, right.code)
      )),
    }))
    .sort((left, right) => compareText(left.code, right.code) || compareText(left.name, right.name));
  const academicCampuses = [...campuses.values()].sort((left, right) => compareText(left.name, right.name));
  const academicSchools = [...schools.values()].sort((left, right) => compareText(left.name, right.name));

  return {
    id: principal.id,
    name: principal.name,
    email: principal.email,
    role: principal.role,
    title: principal.title,
    initials: principal.initials,
    canTeach: principal.canTeach,
    academic: {
      linked: academicSubjects.some((subject) => subject.sections.length > 0),
      campuses: academicCampuses,
      schools: academicSchools,
      subjects: academicSubjects,
      totals: {
        campuses: academicCampuses.length,
        schools: academicSchools.length,
        subjects: academicSubjects.length,
        sections: academicSubjects.reduce((total, subject) => total + subject.sections.length, 0),
      },
    },
  };
}

async function getAccountProfile(principal) {
  const pool = await getPool();
  const result = await pool.request()
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), principal.email.toLowerCase())
    .query(`
      SELECT CONVERT(varchar(36), teacher.docente_id) AS teacherId,
        CONVERT(varchar(36), section.seccion_id) AS sectionId, section.codigo AS sectionCode,
        section.jornada AS shift, period.codigo AS period,
        CONVERT(varchar(36), subject.asignatura_id) AS subjectId,
        subject.codigo AS subjectCode, subject.nombre AS subjectName,
        CONVERT(varchar(36), school.escuela_id) AS schoolId, school.nombre AS schoolName,
        CONVERT(varchar(36), campus.sede_id) AS campusId,
        campus.codigo AS campusCode, campus.nombre AS campusName
      FROM vcm.Docente teacher
      LEFT JOIN vcm.DocenteSeccion assignment
        ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
      LEFT JOIN vcm.Seccion section
        ON section.seccion_id = assignment.seccion_id AND section.activa = 1
      LEFT JOIN vcm.Asignatura subject
        ON subject.asignatura_id = section.asignatura_id AND subject.activa = 1
      LEFT JOIN vcm.Sede campus
        ON campus.sede_id = section.sede_id AND campus.activa = 1
      LEFT JOIN vcm.Escuela school
        ON school.escuela_id = subject.escuela_id AND school.activa = 1
      LEFT JOIN vcm.PeriodoAcademico period
        ON period.periodo_academico_id = section.periodo_academico_id
      WHERE teacher.activo = 1
        AND (
          teacher.usuario_id = @userId
          OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email)
        )
      ORDER BY subject.codigo, campus.nombre, section.codigo;
    `);
  return buildAccountProfile(principal, result.recordset);
}

module.exports = { buildAccountProfile, getAccountProfile };
