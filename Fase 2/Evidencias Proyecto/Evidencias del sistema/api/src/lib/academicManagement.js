const { AppError } = require("./http");
const { UUID_PATTERN, validateManualStudentInput } = require("./projectRoster");

const ACTION_LABELS = {
  TEACHER_ASSIGN: "Asignar profesor",
  TEACHER_REMOVE: "Retirar profesor de la sección",
  TEACHER_REPLACE: "Reemplazar profesor",
  TEACHER_SWAP: "Intercambiar profesores",
  STUDENT_ADD: "Agregar alumno por nombre y RUT",
  STUDENT_ENROLL: "Matricular alumno existente",
  STUDENT_REMOVE: "Retirar alumno de la sección",
  STUDENT_MOVE: "Trasladar alumno",
  STUDENT_SWAP: "Intercambiar alumnos",
};

function validId(value, label = "El identificador") {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new AppError(400, "INVALID_ACADEMIC_ID", `${label} no es válido.`);
  return id;
}

function reasonFor(value) {
  const reason = String(value || "").trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new AppError(400, "ADJUSTMENT_REASON_REQUIRED", "Describe el motivo del cambio con entre 10 y 500 caracteres.");
  }
  return reason;
}

function validateAcademicAdjustment(payload = {}, applying = false) {
  const action = String(payload.action || "").trim().toUpperCase();
  if (!Object.hasOwn(ACTION_LABELS, action)) throw new AppError(400, "INVALID_ADJUSTMENT", "Selecciona una operación válida.");
  const input = { action, sectionId: validId(payload.sectionId, "La sección"), reason: reasonFor(payload.reason) };
  if (action.startsWith("TEACHER_")) input.teacherId = validId(payload.teacherId, "El profesor");
  if (action === "TEACHER_REPLACE") {
    input.previousTeacherId = validId(payload.previousTeacherId, "El profesor saliente");
    if (input.teacherId === input.previousTeacherId) throw new AppError(400, "SAME_TEACHER", "Selecciona dos profesores distintos.");
  }
  if (["TEACHER_SWAP", "STUDENT_MOVE", "STUDENT_SWAP"].includes(action)) {
    input.targetSectionId = validId(payload.targetSectionId, "La sección de destino");
    if (input.targetSectionId === input.sectionId) throw new AppError(400, "SAME_SECTION", "Selecciona dos secciones distintas.");
  }
  if (action === "TEACHER_SWAP") {
    input.otherTeacherId = validId(payload.otherTeacherId, "El otro profesor");
    if (input.teacherId === input.otherTeacherId) throw new AppError(400, "SAME_TEACHER", "Selecciona dos profesores distintos.");
  }
  if (action.startsWith("STUDENT_") && action !== "STUDENT_ADD") input.studentId = validId(payload.studentId, "El alumno");
  if (action === "STUDENT_ADD") Object.assign(input, validateManualStudentInput(payload), { sectionId: input.sectionId });
  if (action === "STUDENT_SWAP") {
    input.otherStudentId = validId(payload.otherStudentId, "El otro alumno");
    if (input.studentId === input.otherStudentId) throw new AppError(400, "SAME_STUDENT", "Selecciona dos alumnos distintos.");
  }
  if (applying) {
    if (payload.confirmed !== true || !String(payload.confirmationCode || "").trim()) {
      throw new AppError(400, "ADJUSTMENT_CONFIRMATION_REQUIRED", "Confirma el cambio y escribe el código de la sección.");
    }
    if (!/^[0-9a-f]{64}$/i.test(String(payload.previewVersion || ""))) {
      throw new AppError(400, "ADJUSTMENT_PREVIEW_REQUIRED", "Revisa la vista previa antes de aplicar el cambio.");
    }
    input.confirmationCode = String(payload.confirmationCode).trim();
    input.previewVersion = payload.previewVersion.toLowerCase();
  }
  return input;
}

function assertCompatibleStudentSections(source, target) {
  if (source.subjectId !== target.subjectId || source.period !== target.period) {
    throw new AppError(409, "INCOMPATIBLE_STUDENT_SECTIONS", "Los traslados e intercambios de alumnos requieren la misma asignatura y período. Para otra asignatura, usa Matricular alumno existente.");
  }
}

function validateTeacherRegistration(payload = {}) {
  const sourceId = String(payload.sourceId || "").trim().toUpperCase().replace(/[.\-\s]/g, "");
  const name = String(payload.name || "").trim().replace(/\s+/g, " ");
  const email = String(payload.email || "").trim().toLowerCase();
  if (sourceId.length < 4 || sourceId.length > 30 || !/^[A-Z0-9]+$/.test(sourceId)) {
    throw new AppError(400, "INVALID_TEACHER_CODE", "Ingresa un RUT o código académico de entre 4 y 30 caracteres alfanuméricos.");
  }
  if (name.length < 3 || name.length > 180 || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new AppError(400, "INVALID_TEACHER_DATA", "Revisa el nombre y el correo institucional del profesor.");
  }
  if (payload.confirmed !== true) throw new AppError(400, "ADJUSTMENT_CONFIRMATION_REQUIRED", "Confirma el registro del nuevo profesor.");
  return { sourceId, name, email, reason: reasonFor(payload.reason) };
}

module.exports = { ACTION_LABELS, validId, validateAcademicAdjustment, assertCompatibleStudentSections, validateTeacherRegistration };
