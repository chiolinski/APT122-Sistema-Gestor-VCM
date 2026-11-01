const REQUIRED_FIELDS = [
  "periodo",
  "sede_codigo",
  "sede_nombre",
  "asignatura_codigo",
  "asignatura_nombre",
  "escuela_nombre",
  "seccion_codigo",
  "docente_id",
  "docente_nombre",
  "estudiante_rut",
  "estudiante_nombre",
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeCode(value) {
  return clean(value).toUpperCase();
}

function normalizeRut(value) {
  return clean(value).replaceAll(".", "").replaceAll("-", "").toUpperCase();
}

function normalizeNameKey(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function validateAcademicRows(rows) {
  const issues = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { canApply: false, summary: emptySummary(1), issues: [{ level: "error", code: "EMPTY_FILE", row: 0, message: "El archivo no contiene registros." }], data: null };
  }

  const campuses = new Map();
  const schools = new Map();
  const subjects = new Map();
  const sections = new Map();
  const teachers = new Map();
  const students = new Map();
  const enrollments = new Map();
  const periods = new Set();
  const studentSubjectSections = new Map();

  rows.forEach((source, index) => {
    const rowNumber = index + 2;
    const row = Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [key, clean(value)]));
    const missing = REQUIRED_FIELDS.filter((field) => !row[field]);
    if (missing.length) {
      issues.push({ level: "error", code: "MISSING_FIELDS", row: rowNumber, message: `Faltan datos obligatorios: ${missing.join(", ")}.` });
      return;
    }

    const period = normalizeCode(row.periodo);
    const campusCode = normalizeCode(row.sede_codigo);
    const subjectCode = normalizeCode(row.asignatura_codigo);
    const schoolKey = normalizeNameKey(row.escuela_nombre);
    const sectionCode = normalizeCode(row.seccion_codigo);
    const teacherId = normalizeCode(row.docente_id);
    const teacherEmail = row.docente_correo?.toLowerCase() || null;
    const studentRut = normalizeRut(row.estudiante_rut);
    const sectionKey = [period, campusCode, subjectCode, sectionCode].join("|");
    const enrollmentKey = `${studentRut}|${subjectCode}`;

    if (teacherEmail && !teacherEmail.includes("@")) issues.push({ level: "warning", code: "INVALID_TEACHER_EMAIL", row: rowNumber, message: "El correo del docente no parece válido y se omitirá." });
    if (row.estudiante_correo && !row.estudiante_correo.includes("@")) issues.push({ level: "warning", code: "INVALID_STUDENT_EMAIL", row: rowNumber, message: "El correo del estudiante no parece válido y se omitirá." });
    if (studentRut.length < 7) issues.push({ level: "error", code: "INVALID_STUDENT_RUT", row: rowNumber, message: "El RUT del estudiante no es válido." });

    const previousSection = studentSubjectSections.get(enrollmentKey);
    if (previousSection && previousSection !== sectionKey) {
      issues.push({ level: "error", code: "STUDENT_MULTIPLE_SECTIONS", row: rowNumber, message: `${row.estudiante_nombre} aparece en dos secciones de ${subjectCode}.` });
    } else {
      studentSubjectSections.set(enrollmentKey, sectionKey);
    }

    periods.add(period);
    campuses.set(campusCode, { code: campusCode, name: row.sede_nombre });
    schools.set(schoolKey, { name: row.escuela_nombre });
    const existingSubject = subjects.get(subjectCode);
    if (existingSubject && existingSubject.schoolKey !== schoolKey) {
      issues.push({ level: "error", code: "SUBJECT_MULTIPLE_SCHOOLS", row: rowNumber, message: `${subjectCode} aparece vinculada a más de una escuela.` });
    } else if (!existingSubject) {
      subjects.set(subjectCode, { code: subjectCode, name: row.asignatura_nombre, schoolName: row.escuela_nombre, schoolKey });
    }
    teachers.set(teacherId, { sourceId: teacherId, name: row.docente_nombre, email: teacherEmail?.includes("@") ? teacherEmail : null });
    sections.set(sectionKey, { key: sectionKey, period, campusCode, subjectCode, code: sectionCode, shift: row.jornada || null, teacherSourceId: teacherId });
    students.set(studentRut, { rut: studentRut, sourceId: row.estudiante_id || studentRut, name: row.estudiante_nombre, email: row.estudiante_correo?.includes("@") ? row.estudiante_correo.toLowerCase() : null });
    enrollments.set(enrollmentKey, { studentRut, subjectCode, sectionKey });
  });

  if (periods.size > 1) issues.push({ level: "error", code: "MULTIPLE_PERIODS", row: 0, message: "Una carga académica sólo puede contener un período." });
  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warning").length;
  const data = {
    period: [...periods][0] || "",
    campuses: [...campuses.values()],
    schools: [...schools.values()],
    subjects: [...subjects.values()].map((subject) => ({ code: subject.code, name: subject.name, schoolName: subject.schoolName })),
    sections: [...sections.values()],
    teachers: [...teachers.values()],
    students: [...students.values()],
    enrollments: [...enrollments.values()],
  };
  return {
    canApply: errors === 0,
    issues,
    summary: {
      rows: rows.length,
      campuses: data.campuses.length,
      schools: data.schools.length,
      subjects: data.subjects.length,
      sections: data.sections.length,
      teachers: data.teachers.length,
      students: data.students.length,
      enrollments: data.enrollments.length,
      errors,
      warnings,
    },
    data,
  };
}

function emptySummary(errors = 0) {
  return { rows: 0, campuses: 0, schools: 0, subjects: 0, sections: 0, teachers: 0, students: 0, enrollments: 0, errors, warnings: 0 };
}

module.exports = { REQUIRED_FIELDS, normalizeRut, validateAcademicRows };
