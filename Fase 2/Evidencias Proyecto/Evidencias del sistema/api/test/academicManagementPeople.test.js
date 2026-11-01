const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");

function peopleSearchFixture(records) {
  const filename = path.resolve(__dirname, "../src/repositories/academicManagementRepository.js");
  const nativeRequire = createRequire(filename);
  const calls = [];
  const module = { exports: {} };
  const db = {
    sql: nativeRequire("mssql"),
    getPool: async () => ({ request: () => {
      const parameters = {};
      return {
        input(name, _type, value) { parameters[name] = value; return this; },
        async query(statement) {
          calls.push({ statement, parameters });
          // Emula el recorte del SQL anterior para que la prueba detecte su regresión.
          return { recordset: /TOP\s*\(50\)/i.test(statement) ? records.slice(0, 50) : records };
        },
      };
    } }),
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports,
    require: (name) => name === "../lib/db" ? db : nativeRequire(name),
  }, { filename });
  return { search: module.exports.searchManagementPeople, calls };
}

test("el selector muestra más de 50 profesores sin recortar ni filtrar por sede", async () => {
  const records = Array.from({ length: 75 }, (_, index) => ({
    id: `teacher-${index}`, name: `Profesor ${String(index).padStart(2, "0")}`,
    sourceId: `6000${index}`, email: `profesor${index}@example.test`, accountReady: index !== 74,
  }));
  const fixture = peopleSearchFixture(records);
  const result = await fixture.search("teachers");
  assert.equal(result.length, 75);
  assert.deepEqual(result, records);
  const { statement, parameters } = fixture.calls[0];
  assert.doesNotMatch(statement, /\bTOP\b|\bOFFSET\b|\bFETCH\b/i);
  assert.doesNotMatch(statement, /@campusId|sede_id|vcm\.DocenteSeccion/i);
  assert.match(statement, /teacher\.activo = 1/);
  assert.match(statement, /ORDER BY teacher\.nombre, teacher\.docente_id/);
  assert.equal(parameters.pattern, "%%");
  assert.equal(result[74].accountReady, false);
});

test("la búsqueda de profesores conserva los filtros por nombre, correo y código", async () => {
  const fixture = peopleSearchFixture([]);
  await fixture.search("teachers", " Luis Videla ");
  const { statement, parameters } = fixture.calls[0];
  assert.equal(parameters.pattern, "%Luis Videla%");
  assert.equal(parameters.normalized, "%LuisVidela%");
  assert.match(statement, /teacher\.nombre LIKE @pattern/);
  assert.match(statement, /teacher\.correo LIKE @pattern/);
  assert.match(statement, /teacher\.identificador_fuente/);
  assert.match(statement, /usr\.rol IN \('TEACHER', 'COORDINATOR'\)/);
});

test("el cambio no altera el límite del buscador de alumnos", async () => {
  const fixture = peopleSearchFixture(Array.from({ length: 75 }, (_, index) => ({ id: `student-${index}` })));
  const result = await fixture.search("students", "Alumno");
  assert.equal(result.length, 50);
  assert.match(fixture.calls[0].statement, /SELECT TOP \(50\)/);
  assert.match(fixture.calls[0].statement, /FROM vcm\.Alumno/);
});
