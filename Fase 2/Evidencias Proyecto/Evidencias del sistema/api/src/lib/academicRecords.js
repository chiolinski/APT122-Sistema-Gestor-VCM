const { AppError } = require("./http");

const ENTITIES = ["campuses", "schools", "subjects", "sections", "teachers", "students"];

function required(value, label, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AppError(400, "INVALID_ACADEMIC_RECORD", `${label} es obligatorio y admite hasta ${maxLength} caracteres.`);
  }
  return normalized;
}

function optional(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length > maxLength) {
    throw new AppError(400, "INVALID_ACADEMIC_RECORD", `Uno de los campos supera los ${maxLength} caracteres permitidos.`);
  }
  return normalized || null;
}

function active(value) {
  if (typeof value !== "boolean") {
    throw new AppError(400, "INVALID_ACADEMIC_RECORD", "El estado del registro no es válido.");
  }
  return value;
}

function email(value) {
  const normalized = optional(value, 320)?.toLowerCase() || null;
  if (normalized && !/^\S+@\S+\.\S+$/.test(normalized)) {
    throw new AppError(400, "INVALID_ACADEMIC_RECORD", "El correo electrónico no es válido.");
  }
  return normalized;
}

function validateAcademicRecordUpdate(entity, input = {}) {
  if (!ENTITIES.includes(entity)) {
    throw new AppError(400, "INVALID_ACADEMIC_ENTITY", "El tipo de dato académico no es válido.");
  }
  if (entity === "campuses") {
    return { code: required(input.code, "El código", 40).toUpperCase(), name: required(input.name, "El nombre", 120), active: active(input.active) };
  }
  if (entity === "schools") {
    return { name: required(input.name, "El nombre", 180), active: active(input.active) };
  }
  if (entity === "subjects") {
    return {
      code: required(input.code, "El código", 40).toUpperCase(),
      name: required(input.name, "El nombre", 180),
      schoolName: optional(input.schoolName, 180),
      active: active(input.active),
    };
  }
  if (entity === "sections") {
    return { code: required(input.code, "El código", 40).toUpperCase(), shift: optional(input.shift, 40), active: active(input.active) };
  }
  if (entity === "teachers") {
    return {
      sourceId: required(input.sourceId, "El RUT o código académico", 200).toUpperCase(),
      name: required(input.name, "El nombre", 180), email: email(input.email), active: active(input.active),
    };
  }
  return {
    sourceId: optional(input.sourceId, 80),
    rut: required(input.rut, "El RUT", 20).replace(/[.\-\s]/g, "").toUpperCase(),
    name: required(input.name, "El nombre", 180), email: email(input.email), active: active(input.active),
  };
}

module.exports = { ENTITIES, validateAcademicRecordUpdate };
