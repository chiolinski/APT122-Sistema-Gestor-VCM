const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const migration = fs.readFileSync(path.resolve(__dirname, "../../database/migrations/017_partner_review_partial_closure.sql"), "utf8");

test("017 conserva el cierre interno y limita enlaces pendientes", () => {
  for (const text of ["cierre_interno bit NOT NULL", "cerrado_por_usuario_id uniqueidentifier NULL",
    "FK_RevisionSocio_CerradoPor", "CK_RevisionSocio_CierreInterno", "SET vence_en = DATEADD(day, 21, creado_en)",
    "WHERE revocado_en IS NULL AND completado_en IS NULL"]) {
    assert.ok(migration.includes(text));
  }
  assert.equal(/(?:UPDATE|DELETE\s+FROM)\s+vcm\.(?:Hito|Avance|Evaluacion)/i.test(migration), false);
  assert.equal(/SET completado_en/i.test(migration), false);
});

test("017 se incluye como migración identificable en el entorno local", () => {
  const runner = fs.readFileSync(path.resolve(__dirname, "../scripts/migrate.js"), "utf8");
  assert.match(runner, /EXPECTED_DATABASE = "vcm_piloto_2026_local"/);
  assert.match(runner, /transaction\.rollback\(\)/);
});
