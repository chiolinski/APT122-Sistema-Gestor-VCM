const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const id = (number) => `6f9619ff-8b86-d011-b42d-${String(number).padStart(12, "0")}`;
const principal = { id: id(9), email: "teacher@example.test", role: "teacher", canTeach: true };

function fixture() {
  let state = { assigned: true, review: { id: id(5), teamsJson: JSON.stringify([{ id: id(3), name: "Equipo 1" }]), completedAt: null },
    evaluations: [{ teamId: id(3), strengths: "Fortaleza", improvements: "Mejora", rating: 4 }],
    opening: { available: true, availableFrom: "2026-01-01" }, writes: [], audits: [], failWrite: false };
  class Request {
    constructor() { this.p = {}; }
    input(name, _type, value) { this.p[name] = value; return this; }
    async query(sql) {
      const rows = (recordset) => ({ recordset: structuredClone(recordset) });
      if (sql.includes("AS databaseId")) return rows([]); // listProjects after successful transaction
      if (sql.includes("AS teacherAssigned")) return rows([{ id: id(1), status: "EN_EJECUCION", teacherAssigned: true }]);
      if (sql.includes("AS id, section.codigo AS code")) return rows(state.assigned ? [{ id: id(2), code: "001D" }] : []);
      if (sql.includes("milestoneOne.estado AS milestoneOneStatus")) return rows([{ milestoneOneStatus: "COMPLETADO", ...state.opening }]);
      if (sql.includes("SELECT numero AS number, estado AS status")) return rows([{ number: 1, status: "COMPLETADO" }, { number: 2, status: "PENDIENTE" }]);
      if (sql.includes("FROM vcm.RevisionSocio")) { assert.equal(this.p.sectionId, id(2)); return rows(state.review ? [state.review] : []); }
      if (sql.includes("FROM vcm.EvaluacionSocioEquipo")) return rows(state.evaluations);
      if (sql.includes("FROM vcm.Equipo")) return rows([{ id: id(3), name: "Equipo 1" }]);
      if (/UPDATE|MERGE/.test(sql)) {
        if (state.failWrite) throw new Error("SQL write failed");
        state.writes.push({ sql, p: this.p }); return { recordset: [], rowsAffected: [1] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  }
  const db = { sql: { Request, VarChar: () => "text", NVarChar: () => "text", UniqueIdentifier: "uuid", TinyInt: "int" },
    getPool: async () => ({ request: () => new Request() }), withTransaction: async (operation) => {
      const previous = structuredClone(state);
      try { return await operation({}); } catch (error) { state = previous; throw error; }
    } };
  const helperFile = path.resolve(__dirname, "../src/lib/hitoTwoWorkflow.js");
  const helperRequire = createRequire(helperFile);
  const helper = { exports: {} };
  vm.runInNewContext(fs.readFileSync(helperFile, "utf8"), { module: helper, require: (name) => name === "./db" ? db : helperRequire(name) });
  const filename = path.resolve(__dirname, "../src/repositories/projectRepository.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, require: (name) => {
    if (name === "../lib/db") return db;
    if (name === "../lib/hitoTwoWorkflow") return helper.exports;
    if (name === "../lib/audit") return { writeAudit: async (_transaction, _actor, event) => state.audits.push(event) };
    return nativeRequire(name);
  } });
  return { repository: module.exports, get state() { return state; } };
}

const input = { sectionId: id(2), advance: "Avance", conclusions: "Conclusiones", reviewId: id(5), feedbackReviewed: true };

test("sin apertura de coordinación o con fecha futura, ni una evaluación final permite cerrar Hito 2", async () => {
  for (const availableFrom of [null, "2099-01-01"]) {
    const f = fixture();
    f.state.opening = { available: false, availableFrom };
    f.state.review.completedAt = "2026-10-20T15:00:00Z";
    await assert.rejects(f.repository.saveProjectProgress("VCM-1", input, principal), {
      code: availableFrom ? "MILESTONE_TWO_NOT_OPEN" : "MILESTONE_TWO_NOT_SCHEDULED",
    });
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.audits.length, 0);
  }
});
test("el endpoint de avance ya no puede completar Hito 2 antes de la retroalimentación ni desde otra sección", async () => {
  const f = fixture();
  await assert.rejects(f.repository.saveProjectProgress("VCM-1", input, principal), { code: "FEEDBACK_NOT_COMPLETED" });
  assert.equal(f.state.writes.length, 0);
  f.state.review.completedAt = "2026-10-20T15:00:00Z";
  await assert.rejects(f.repository.saveProjectProgress("VCM-1", { ...input, feedbackReviewed: false }, principal), { code: "FEEDBACK_ACK_REQUIRED" });
  f.state.assigned = false;
  await assert.rejects(f.repository.saveProjectProgress("VCM-1", input, principal), { code: "SECTION_ACCESS_DENIED" });
  assert.equal(f.state.writes.length, 0);
});

test("el cierre guarda la revisión y la fecha de lectura, completa sólo esa sección y audita en la misma transacción", async () => {
  const f = fixture();
  f.state.review.completedAt = "2026-10-20T15:00:00Z";
  await f.repository.saveProjectProgress("VCM-1", input, principal);
  const write = f.state.writes[0];
  assert.equal(write.p.reviewId, id(5)); assert.equal(write.p.sectionId, id(2));
  assert.match(write.sql, /revision_socio_id = @reviewId/);
  assert.match(write.sql, /retroalimentacion_revisada_en = SYSUTCDATETIME/);
  assert.match(write.sql, /seccion_id = @sectionId AND numero = 2/);
  assert.equal(f.state.writes.length, 2); // section closure and aggregate synchronization
  assert.equal(f.state.audits[0].data.reviewId, id(5));
  assert.equal(f.state.audits[0].data.feedbackReviewed, true);
});
