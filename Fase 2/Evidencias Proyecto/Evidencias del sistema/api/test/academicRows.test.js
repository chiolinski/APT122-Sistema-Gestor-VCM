const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAcademicRows } = require("../src/lib/academicRows");

function row(overrides = {}) {
  return {
    periodo: "2026-2", sede_codigo: "AV", sede_nombre: "Antonio Varas",
    asignatura_codigo: "ASY4131", asignatura_nombre: "Arquitectura de Software",
    escuela_nombre: "Escuela de Informática y Telecomunicaciones",
    seccion_codigo: "001D", jornada: "Diurna", docente_id: "1234",
    docente_nombre: "Alejandro Soto", docente_correo: "alejandro.soto@duoc.cl",
    estudiante_id: "100", estudiante_rut: "21.234.567-8", estudiante_nombre: "Amanda Díaz Soto",
    estudiante_correo: "amanda@duocuc.cl", ...overrides,
  };
}

test("normaliza una carga académica válida", () => {
  const result = validateAcademicRows([row(), row({ estudiante_id: "101", estudiante_rut: "20.345.678-9", estudiante_nombre: "Benjamín López" })]);
  assert.equal(result.canApply, true);
  assert.equal(result.summary.sections, 1);
  assert.equal(result.summary.schools, 1);
  assert.equal(result.summary.students, 2);
  assert.equal(result.data.period, "2026-2");
});

test("rechaza un estudiante en dos secciones de la misma asignatura", () => {
  const result = validateAcademicRows([row(), row({ seccion_codigo: "002D" })]);
  assert.equal(result.canApply, false);
  assert.ok(result.issues.some((issue) => issue.code === "STUDENT_MULTIPLE_SECTIONS"));
});

test("rechaza filas sin campos obligatorios", () => {
  const result = validateAcademicRows([row({ docente_nombre: "" })]);
  assert.equal(result.canApply, false);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_FIELDS"));
});

test("rechaza una asignatura vinculada a dos escuelas", () => {
  const result = validateAcademicRows([row(), row({ escuela_nombre: "Escuela de Administración", estudiante_rut: "20.345.678-9" })]);
  assert.equal(result.canApply, false);
  assert.ok(result.issues.some((issue) => issue.code === "SUBJECT_MULTIPLE_SCHOOLS"));
});

test("permite cargar un docente sin correo y vincular su cuenta posteriormente", () => {
  const result = validateAcademicRows([row({ docente_correo: "" })]);
  assert.equal(result.canApply, true);
  assert.equal(result.data.teachers[0].email, null);
});

test("advierte y omite un correo docente inválido sin bloquear la carga", () => {
  const result = validateAcademicRows([row({ docente_correo: "sin-correo" })]);
  assert.equal(result.canApply, true);
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.data.teachers[0].email, null);
});
