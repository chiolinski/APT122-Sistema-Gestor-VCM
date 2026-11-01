const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UUID_PATTERN,
  validateManualStudentInput,
  validateSectionId,
  validateStudentRemovalInput,
} = require("../src/lib/projectRoster");

const sectionId = "123e4567-e89b-12d3-a456-426614174000";

test("normaliza los datos de un alumno agregado manualmente", () => {
  assert.deepEqual(validateManualStudentInput({
    sectionId,
    name: "  María   José Pérez  ",
    rut: "12.345.678-5",
  }), {
    sectionId,
    name: "María José Pérez",
    rut: "123456785",
  });
});

test("rechaza un RUT inválido al agregar un alumno", () => {
  assert.throws(
    () => validateManualStudentInput({ sectionId, name: "Alumno Prueba", rut: "00.000.000-0" }),
    (error) => error.status === 400 && error.code === "INVALID_STUDENT_RUT",
  );
});

test("rechaza nombres vacíos o demasiado extensos", () => {
  assert.throws(
    () => validateManualStudentInput({ sectionId, name: " ", rut: "12.345.678-5" }),
    (error) => error.status === 400 && error.code === "INVALID_STUDENT_NAME",
  );
  assert.throws(
    () => validateManualStudentInput({ sectionId, name: "A".repeat(181), rut: "12.345.678-5" }),
    (error) => error.status === 400 && error.code === "INVALID_STUDENT_NAME",
  );
});

test("exige una sección válida al agregar o retirar", () => {
  assert.throws(
    () => validateManualStudentInput({ sectionId: "invalida", name: "Alumno Prueba", rut: "12.345.678-5" }),
    (error) => error.status === 400 && error.code === "INVALID_SECTION",
  );
  assert.throws(
    () => validateStudentRemovalInput({ sectionId: "" }),
    (error) => error.status === 400 && error.code === "INVALID_SECTION",
  );
});

test("acepta la sección al solicitar un retiro", () => {
  assert.deepEqual(validateStudentRemovalInput({ sectionId }), { sectionId });
});

test("acepta identificadores de SQL Server sin restringir versión ni variante UUID", () => {
  const sqlSectionIds = [
    "6F9619FF-8B86-D011-B42D-00C04FC964FF",
    "00112233-4455-f677-0899-aabbccddeeff",
    "00112233-4455-0677-c899-aabbccddeeff",
  ];
  for (const sqlSectionId of sqlSectionIds) {
    assert.equal(validateSectionId(` ${sqlSectionId} `), sqlSectionId);
    assert.deepEqual(validateManualStudentInput({
      sectionId: sqlSectionId,
      name: "Alumno Prueba",
      rut: "12.345.678-5",
    }), {
      sectionId: sqlSectionId,
      name: "Alumno Prueba",
      rut: "123456785",
    });
    assert.deepEqual(validateStudentRemovalInput({ sectionId: sqlSectionId }), {
      sectionId: sqlSectionId,
    });
    // El repositorio usa el mismo patrón para los identificadores de alumnos.
    assert.equal(UUID_PATTERN.test(sqlSectionId), true);
  }
});

test("rechaza identificadores malformados sin permitir truncamientos de SQL Server", () => {
  const invalidIds = [
    undefined, null, "", "invalida",
    "6F9619FF-8B86-D011-B42D-00C04FC964FG",
    "6F9619FF8B86D011B42D00C04FC964FF",
    "6F9619FF-8B86-D011-B42D-00C04FC964F",
    "6F9619FF-8B86-D011-B42D-00C04FC964FFextra",
    "{6F9619FF-8B86-D011-B42D-00C04FC964FF}",
  ];
  for (const invalidId of invalidIds) {
    assert.throws(
      () => validateManualStudentInput({ sectionId: invalidId, name: "Alumno Prueba", rut: "12.345.678-5" }),
      (error) => error.status === 400 && error.code === "INVALID_SECTION",
    );
    assert.throws(
      () => validateStudentRemovalInput({ sectionId: invalidId }),
      (error) => error.status === 400 && error.code === "INVALID_SECTION",
    );
  }
});
