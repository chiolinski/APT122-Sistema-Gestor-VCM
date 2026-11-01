const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(number) {
  const failure = Object.assign(new Error("SQL audit failed"), { number });
  class Request {
    input() { return this; }
    async query() { throw failure; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/lib/audit.js"), "utf8"), {
    module, require: () => ({ sql: { Request, UniqueIdentifier: "uuid", NVarChar: () => "text", VarChar: () => "text" } }),
  });
  return { writeAudit: module.exports.writeAudit, failure };
}

const event = { action: "PARTNER_REVIEW_CLOSED_INTERNALLY", entity: "RevisionSocio", entityId: "review", description: "Cierre" };
test("la auditoría obligatoria propaga una tabla faltante para revertir el cierre interno", async () => {
  const f = fixture(208);
  await assert.rejects(f.writeAudit({}, null, event, { required: true }), (error) => error === f.failure);
});
test("la opción estricta no cambia la compatibilidad histórica ni oculta otros errores SQL", async () => {
  await fixture(208).writeAudit({}, null, event);
  const f = fixture(1205);
  await assert.rejects(f.writeAudit({}, null, event), (error) => error === f.failure);
  await assert.rejects(f.writeAudit({}, null, event, { required: true }), (error) => error === f.failure);
});
