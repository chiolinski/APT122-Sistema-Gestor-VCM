const path = require("node:path");
const { AppError } = require("./http");

const FILE_CATEGORIES = new Set(["ANTECEDENTE", "ENTREGABLE_HITO_2"]);
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".png", ".jpg", ".jpeg", ".zip",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFilename(value) {
  const withoutControlCharacters = [...String(value || "")]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join("");
  const raw = withoutControlCharacters.normalize("NFC").replace(/[\\/]/g, "-").trim();
  const compact = raw.replace(/\s+/g, " ").slice(0, 260);
  if (!compact || compact === "." || compact === "..") {
    throw new AppError(400, "INVALID_FILE_NAME", "El nombre del archivo no es válido.");
  }
  return compact;
}

function validateProjectFile(input, maxBytes) {
  const category = String(input.category || "").trim().toUpperCase();
  if (!FILE_CATEGORIES.has(category)) {
    throw new AppError(400, "INVALID_FILE_CATEGORY", "La categoría del archivo no es válida.");
  }
  const name = sanitizeFilename(input.name);
  const extension = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new AppError(400, "FILE_TYPE_NOT_ALLOWED", "El tipo de archivo no está permitido.");
  }
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new AppError(400, "EMPTY_FILE", "Selecciona un archivo con contenido.");
  }
  if (size > maxBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", `El archivo supera el máximo permitido de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const sectionId = String(input.sectionId || "").trim() || null;
  if (category === "ENTREGABLE_HITO_2" && !sectionId) {
    throw new AppError(400, "SECTION_REQUIRED", "Debes indicar la sección del entregable.");
  }
  if (category === "ANTECEDENTE" && sectionId) {
    throw new AppError(400, "SECTION_NOT_ALLOWED", "El antecedente general no debe asociarse a una sección.");
  }
  if (sectionId && !UUID_PATTERN.test(sectionId)) {
    throw new AppError(400, "INVALID_SECTION_ID", "La sección indicada no es válida.");
  }
  const replaceFileId = String(input.replaceFileId || "").trim() || null;
  if (replaceFileId && (category !== "ANTECEDENTE" || !UUID_PATTERN.test(replaceFileId))) {
    throw new AppError(400, "INVALID_REPLACEMENT_FILE", "El archivo que deseas reemplazar no es válido.");
  }
  const contentType = String(input.contentType || "application/octet-stream").trim().slice(0, 150) || "application/octet-stream";
  return { category, name, extension, size, sectionId, replaceFileId, contentType };
}

function buildStorageKey(projectId, fileId, descriptor) {
  const scope = descriptor.sectionId || "general";
  return `projects/${projectId}/${descriptor.category.toLowerCase()}/${scope}/${fileId}${descriptor.extension}`;
}

function assertProjectFileDeletionAllowed(file, principal) {
  if (file.category !== "ANTECEDENTE") {
    throw new AppError(403, "FILE_DELETE_DENIED", "Sólo se pueden eliminar antecedentes generales de la propuesta.");
  }
  const isAdministrator = principal.role === "admin";
  const isUploaderCoordinator = principal.role === "coordinator"
    && String(file.uploadedBy || "").toLowerCase() === String(principal.id || "").toLowerCase();
  if (!isAdministrator && !isUploaderCoordinator) {
    throw new AppError(403, "FILE_DELETE_DENIED", "Sólo un Administrador o el Coordinador CITT que subió este archivo puede eliminarlo.");
  }
  if (["FINALIZADO", "CANCELADO"].includes(file.projectStatus)) {
    throw new AppError(409, "PROJECT_FILE_LOCKED", "El archivo no puede eliminarse porque el proyecto ya está cerrado.");
  }
}

module.exports = { ALLOWED_EXTENSIONS, FILE_CATEGORIES, UUID_PATTERN, assertProjectFileDeletionAllowed, buildStorageKey, sanitizeFilename, validateProjectFile };
