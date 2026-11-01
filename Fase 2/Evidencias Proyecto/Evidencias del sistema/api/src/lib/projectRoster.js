const { AppError } = require("./http");
const { isValidRut, normalizeRut } = require("./partnerRows");

// SQL Server uniqueidentifier admite GUID sin restringir versión ni variante UUID.
// La pertenencia de la sección y los permisos se verifican en el repositorio.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeStudentName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validateSectionId(value) {
  const sectionId = String(value || "").trim();
  if (!UUID_PATTERN.test(sectionId)) {
    throw new AppError(400, "INVALID_SECTION", "Debes seleccionar una sección válida.");
  }
  return sectionId;
}

function validateManualStudentInput(payload = {}) {
  const sectionId = validateSectionId(payload.sectionId);
  const name = normalizeStudentName(payload.name);
  const formattedRut = normalizeRut(payload.rut);
  if (name.length < 2 || name.length > 180) {
    throw new AppError(400, "INVALID_STUDENT_NAME", "El nombre del estudiante debe tener entre 2 y 180 caracteres.");
  }
  if (!isValidRut(formattedRut)) {
    throw new AppError(400, "INVALID_STUDENT_RUT", "El RUT del estudiante no es válido.");
  }
  return { sectionId, name, rut: formattedRut.replace("-", "") };
}

function validateStudentRemovalInput(payload = {}) {
  return { sectionId: validateSectionId(payload.sectionId) };
}

module.exports = {
  UUID_PATTERN,
  normalizeStudentName,
  validateManualStudentInput,
  validateSectionId,
  validateStudentRemovalInput,
};
