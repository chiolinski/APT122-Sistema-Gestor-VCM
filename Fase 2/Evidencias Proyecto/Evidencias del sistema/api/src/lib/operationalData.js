const { AppError } = require("./http");
const { MAX_BUSINESS_NAME_LENGTH, isValidPhone, isValidRut, normalizeRut } = require("./partnerRows");

function clean(value) {
  return String(value ?? "").trim();
}

function required(value, field) {
  const result = clean(value);
  if (!result) throw new AppError(400, "MISSING_FIELD", `El campo ${field} es obligatorio.`);
  return result;
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new AppError(400, "MISSING_SELECTION", `Debes seleccionar al menos un elemento en ${field}.`);
  }
  return [...new Set(values.map(clean).filter(Boolean))];
}

function validatePartnerInput(payload = {}) {
  const businessName = required(payload.businessName, "razón social");
  if (businessName.length > MAX_BUSINESS_NAME_LENGTH) {
    throw new AppError(400, "PARTNER_BUSINESS_NAME_TOO_LONG", `La razón social supera el máximo de ${MAX_BUSINESS_NAME_LENGTH} caracteres.`);
  }
  const contactEmail = required(payload.contactEmail, "correo de contacto").toLowerCase();
  if (!contactEmail.includes("@")) throw new AppError(400, "INVALID_CONTACT_EMAIL", "El correo de contacto no es válido.");
  const taxId = normalizeRut(required(payload.taxId, "RUT"));
  if (!isValidRut(taxId)) throw new AppError(400, "INVALID_PARTNER_RUT", "El RUT del socio formador no es válido.");
  const phone = clean(payload.phone);
  if (!isValidPhone(phone)) throw new AppError(400, "INVALID_PARTNER_PHONE", "Ingresa uno o dos teléfonos usando solo números, espacios, paréntesis y un signo + al inicio.");
  return {
    businessName,
    taxId,
    industry: clean(payload.industry).slice(0, 150) || null,
    contactName: required(payload.contactName, "nombre de contacto").slice(0, 180),
    contactEmail: contactEmail.slice(0, 320),
    phone: phone.slice(0, 40) || null,
  };
}

function validateProjectInput(payload = {}) {
  return {
    partnerId: required(payload.partnerId, "socio formador"),
    name: required(payload.name, "nombre del proyecto").slice(0, 220),
    description: required(payload.description, "descripción"),
    expectedResult: required(payload.expectedResult, "resultado esperado"),
    subjectId: required(payload.subjectId, "asignatura"),
    campusIds: uniqueStrings(payload.campusIds, "sedes"),
    sectionIds: uniqueStrings(payload.sectionIds, "secciones responsables"),
  };
}

function validateProgressInput(payload = {}) {
  return {
    sectionId: required(payload.sectionId, "sección"),
    advance: required(payload.advance, "avance del resultado").slice(0, 20000),
    conclusions: required(payload.conclusions, "conclusiones").slice(0, 20000),
    reviewId: typeof payload.reviewId === "string" ? payload.reviewId : "",
    feedbackReviewed: payload.feedbackReviewed === true,
  };
}

function validateMilestoneScheduleInput(payload = {}) {
  const availableFrom = required(payload.availableFrom, "fecha de apertura");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(availableFrom) || Number.isNaN(Date.parse(`${availableFrom}T12:00:00Z`))) {
    throw new AppError(400, "INVALID_MILESTONE_DATE", "La fecha de apertura no es válida.");
  }
  return { availableFrom };
}

function validateMilestoneReopenInput(payload = {}, milestoneNumber) {
  const number = Number(milestoneNumber);
  const reason = required(payload.reason, "motivo de reapertura");
  if (![1, 2, 3].includes(number)) {
    throw new AppError(400, "INVALID_MILESTONE", "El hito indicado no es válido.");
  }
  if (reason.length < 10) {
    throw new AppError(400, "REOPEN_REASON_TOO_SHORT", "El motivo de reapertura debe tener al menos 10 caracteres.");
  }
  return {
    sectionId: required(payload.sectionId, "sección"),
    milestoneNumber: number,
    reason: reason.slice(0, 500),
  };
}

module.exports = {
  validateMilestoneReopenInput,
  validateMilestoneScheduleInput,
  validatePartnerInput,
  validateProgressInput,
  validateProjectInput,
};
