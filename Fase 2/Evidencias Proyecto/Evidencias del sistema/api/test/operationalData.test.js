const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateMilestoneReopenInput,
  validateMilestoneScheduleInput,
  validatePartnerInput,
  validateProgressInput,
  validateProjectInput,
} = require("../src/lib/operationalData");

test("normaliza los datos obligatorios de un socio formador", () => {
  const result = validatePartnerInput({ businessName: " Fundación Uno ", taxId: "76.123.456-0", contactName: "Ana Pérez", contactEmail: "ANA@EJEMPLO.CL", phone: "+56912345678" });
  assert.equal(result.businessName, "Fundación Uno");
  assert.equal(result.taxId, "76123456-0");
  assert.equal(result.contactEmail, "ana@ejemplo.cl");
  assert.equal(result.industry, null);
  assert.equal(result.phone, "+56912345678");
});

test("acepta 350 caracteres y rechaza 351 en la razón social", () => {
  const partner = { taxId: "76.123.456-0", contactName: "Ana", contactEmail: "ana@ejemplo.cl" };
  assert.equal(validatePartnerInput({ ...partner, businessName: "A".repeat(350) }).businessName.length, 350);
  assert.throws(
    () => validatePartnerInput({ ...partner, businessName: "A".repeat(351) }),
    /máximo de 350 caracteres/,
  );
});

test("rechaza un correo de contacto inválido", () => {
  assert.throws(() => validatePartnerInput({ businessName: "Fundación", taxId: "1-9", contactName: "Ana", contactEmail: "correo" }), /no es válido/);
});

test("rechaza el RUT de relleno 00000000-0", () => {
  assert.throws(
    () => validatePartnerInput({ businessName: "Fundación", taxId: "00000000-0", contactName: "Ana", contactEmail: "ana@ejemplo.cl" }),
    /RUT del socio formador no es válido/,
  );
});

test("acepta paréntesis y hasta dos teléfonos", () => {
  const partner = { businessName: "Fundación", taxId: "76.123.456-0", contactName: "Ana", contactEmail: "ana@ejemplo.cl" };
  for (const phone of ["(41) 213 7355", "+56 (41) 213 7355", "+56944726359 +56995434798"]) {
    assert.equal(validatePartnerInput({ ...partner, phone }).phone, phone);
  }
});

test("rechaza letras, puntuación no permitida y más de dos teléfonos", () => {
  const partner = { businessName: "Fundación", taxId: "76.123.456-0", contactName: "Ana", contactEmail: "ana@ejemplo.cl" };
  for (const phone of ["+56-9-1234-5678", "+569ABC5678", "56+912345678", "+5691,+5692", "+5691 +5692 +5693"]) {
    assert.throws(() => validatePartnerInput({ ...partner, phone }), /uno o dos teléfonos/);
  }
});

test("normaliza una propuesta con selecciones sin duplicados", () => {
  const result = validateProjectInput({
    partnerId: "partner", name: "Proyecto", description: "Descripción", expectedResult: "Resultado", subjectId: "subject",
    campusIds: ["campus-1", "campus-1"],
    sectionIds: ["section-1", "section-1"],
  });
  assert.deepEqual(result.campusIds, ["campus-1"]);
  assert.deepEqual(result.sectionIds, ["section-1"]);
  assert.equal("startDate" in result, false);
});

test("rechaza una propuesta sin sedes", () => {
  assert.throws(() => validateProjectInput({
    partnerId: "partner", name: "Proyecto", description: "Descripción", expectedResult: "Resultado", subjectId: "subject",
    campusIds: [], sectionIds: ["section-1"],
  }), /seleccionar al menos un elemento/);
});

test("rechaza una propuesta sin secciones responsables", () => {
  assert.throws(() => validateProjectInput({
    partnerId: "partner", name: "Proyecto", description: "Descripción", expectedResult: "Resultado", subjectId: "subject",
    campusIds: ["campus-1"], sectionIds: [],
  }), /secciones responsables/);
});

test("normaliza el avance y las conclusiones del Hito 2", () => {
  assert.deepEqual(
    validateProgressInput({ sectionId: " section-1 ", advance: " Avance validado ", conclusions: " Conclusiones acordadas " }),
    { sectionId: "section-1", advance: "Avance validado", conclusions: "Conclusiones acordadas", reviewId: "", feedbackReviewed: false },
  );
});

test("rechaza un Hito 2 incompleto", () => {
  assert.throws(() => validateProgressInput({ sectionId: "section-1", advance: "Avance", conclusions: "" }), /conclusiones/);
});

test("rechaza un Hito 2 sin sección", () => {
  assert.throws(() => validateProgressInput({ advance: "Avance", conclusions: "Conclusiones" }), /sección/);
});

test("normaliza la fecha de apertura del Hito 2", () => {
  assert.deepEqual(validateMilestoneScheduleInput({ availableFrom: "2026-09-15" }), { availableFrom: "2026-09-15" });
});

test("rechaza una fecha de apertura inválida", () => {
  assert.throws(() => validateMilestoneScheduleInput({ availableFrom: "15/09/2026" }), /no es válida/);
});

test("exige un motivo suficiente para reabrir un hito", () => {
  assert.deepEqual(
    validateMilestoneReopenInput({ sectionId: "section-1", reason: " Corregir equipos incompletos " }, "1"),
    { sectionId: "section-1", milestoneNumber: 1, reason: "Corregir equipos incompletos" },
  );
  assert.throws(
    () => validateMilestoneReopenInput({ sectionId: "section-1", reason: "Error" }, "2"),
    /al menos 10 caracteres/,
  );
});
