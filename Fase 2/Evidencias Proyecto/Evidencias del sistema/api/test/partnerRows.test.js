const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidRut, normalizeRut, validatePartnerRows } = require("../src/lib/partnerRows");

function row(overrides = {}) {
  return {
    rut: "76.123.456-0",
    razon_social: "Fundación Ejemplo",
    rubro: "Educación",
    nombre_contacto: "Ana Pérez",
    correo_contacto: "ana@ejemplo.cl",
    telefono: "+56912345678",
    ...overrides,
  };
}

test("normaliza y valida un RUT chileno", () => {
  assert.equal(normalizeRut("76.123.456-0"), "76123456-0");
  assert.equal(isValidRut("76.123.456-0"), true);
  assert.equal(isValidRut("76.123.456-7"), false);
  assert.equal(isValidRut("00000000-0"), false);
  assert.equal(isValidRut("0-0"), false);
});

test("rechaza un RUT de relleno compuesto solo por ceros", () => {
  const result = validatePartnerRows([row({ rut: "00000000-0" })]);
  assert.equal(result.canApply, false);
  assert.ok(result.issues.some((issue) => issue.code === "INVALID_RUT"));
});

test("normaliza una carga válida de socios formadores", () => {
  const result = validatePartnerRows([row()]);
  assert.equal(result.canApply, true);
  assert.equal(result.summary.partners, 1);
  assert.equal(result.data[0].taxId, "76123456-0");
  assert.equal(result.data[0].contactEmail, "ana@ejemplo.cl");
});

test("acepta hasta 350 caracteres en la razón social", () => {
  assert.equal(validatePartnerRows([row({ razon_social: "A".repeat(350) })]).canApply, true);
  const oversized = validatePartnerRows([row({ razon_social: "A".repeat(351) })]);
  assert.equal(oversized.canApply, false);
  assert.ok(oversized.issues.some((issue) => issue.code === "FIELD_TOO_LONG"));
});

test("omite una repetición idéntica y genera advertencia", () => {
  const result = validatePartnerRows([row(), row({ rut: "76123456-0" })]);
  assert.equal(result.canApply, true);
  assert.equal(result.summary.partners, 1);
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.warnings, 1);
});

test("rechaza un RUT repetido con información contradictoria", () => {
  const result = validatePartnerRows([row(), row({ razon_social: "Otra organización" })]);
  assert.equal(result.canApply, false);
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_RUT_CONFLICT"));
});

test("rechaza filas con correo o campos obligatorios inválidos", () => {
  const invalidEmail = validatePartnerRows([row({ correo_contacto: "sin-correo" })]);
  const missingName = validatePartnerRows([row({ razon_social: "" })]);
  assert.equal(invalidEmail.canApply, false);
  assert.ok(invalidEmail.issues.some((issue) => issue.code === "INVALID_EMAIL"));
  assert.equal(missingName.canApply, false);
  assert.ok(missingName.issues.some((issue) => issue.code === "MISSING_FIELDS"));
});

test("rechaza texto dañado por una decodificación incorrecta", () => {
  const result = validatePartnerRows([row({ razon_social: "Fundaci�n Ejemplo" })]);
  assert.equal(result.canApply, false);
  assert.ok(result.issues.some((issue) => issue.code === "INVALID_TEXT_ENCODING"));
});

test("acepta uno o dos teléfonos con espacios y paréntesis", () => {
  for (const telefono of [
    "+56912345678", "56912345678", "", "(41) 213 7355", "+56 (41) 213 7355",
    "+56944726359 +56995434798", "(41) 213 7355 (41) 234 5678",
  ]) {
    assert.equal(validatePartnerRows([row({ telefono })]).canApply, true);
  }

  for (const telefono of [
    "+56-9-1234-5678", "+569ABC5678", "56+912345678", "(41 2137355",
    "+56911111111 +56922222222 +56933333333",
  ]) {
    const result = validatePartnerRows([row({ telefono })]);
    assert.equal(result.canApply, false);
    assert.ok(result.issues.some((issue) => issue.code === "INVALID_PHONE"));
  }
});
