const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const migration = fs.readFileSync(path.resolve(__dirname, "../../database/migrations/016_hito_two_feedback_closure.sql"), "utf8");

// Los instaladores SSMS se excluyen: este repositorio utiliza el migrador local.
test("la migración local 016 conserva entregas y columnas de revisión docente", () => {
  assert.match(migration, /CREATE TABLE vcm\.EntregaVideoEquipo/);
  for (const column of ["revision_socio_id uniqueidentifier NULL", "retroalimentacion_revisada_en datetime2(0) NULL"]) {
    assert.ok(migration.includes(column));
  }
});

test("016 no modifica ni elimina estados de hitos existentes", () => {
  assert.equal(/\bDELETE\s+(?:FROM\s+)?vcm\.|\bUPDATE\s+vcm\./i.test(migration), false);
});
