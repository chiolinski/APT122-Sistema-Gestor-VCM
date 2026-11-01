const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAcademicRecordUpdate } = require("../src/lib/academicRecords");

test("normaliza una corrección manual de docente", () => {
  const record = validateAcademicRecordUpdate("teachers", {
    sourceId: " 12.345.678-9 ", name: " Docente Uno ", email: "DOCENTE@DUOC.CL", active: true,
  });
  assert.equal(record.sourceId, "12.345.678-9");
  assert.equal(record.email, "docente@duoc.cl");
});

test("normaliza el RUT de un estudiante", () => {
  const record = validateAcademicRecordUpdate("students", {
    sourceId: "A-1", rut: "21.234.567-8", name: "Estudiante Uno", email: "", active: true,
  });
  assert.equal(record.rut, "212345678");
  assert.equal(record.email, null);
});

test("normaliza una escuela y la vinculación de una asignatura", () => {
  const school = validateAcademicRecordUpdate("schools", { name: " Escuela de Informática ", active: true });
  const subject = validateAcademicRecordUpdate("subjects", {
    code: " asy4131 ", name: "Arquitectura de Software", schoolName: " Escuela de Informática ", active: true,
  });
  assert.equal(school.name, "Escuela de Informática");
  assert.equal(subject.code, "ASY4131");
  assert.equal(subject.schoolName, "Escuela de Informática");
});

test("rechaza un correo manual inválido", () => {
  assert.throws(() => validateAcademicRecordUpdate("teachers", {
    sourceId: "123", name: "Docente Uno", email: "correo-invalido", active: true,
  }), { code: "INVALID_ACADEMIC_RECORD" });
});

test("rechaza entidades académicas desconocidas", () => {
  assert.throws(() => validateAcademicRecordUpdate("unknown", {}), { code: "INVALID_ACADEMIC_ENTITY" });
});
