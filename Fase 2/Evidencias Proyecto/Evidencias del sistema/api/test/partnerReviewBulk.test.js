const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const { AppError } = require("../src/lib/http");
const { assertFinalReviewFeedback, isFinalReviewFeedback } = require("../src/lib/partnerReviews");

const id = (n) => `6f9619ff-8b86-d011-b42d-${String(n).padStart(12, "0")}`;
const admin = { id: id(90), role: "admin", email: "admin@example.test" };
const teams = Array.from({ length: 20 }, (_, i) => ({ id: id(100 + i), name: `Equipo ${i + 1}` }));
const evaluation = (i = 0) => ({ teamId: teams[i].id, strengths: "Buena propuesta", improvements: "Ampliar pruebas", rating: 4, reviewedAt: "2026-10-25T12:00:00Z" });
const review = (n, evaluated = 0, overrides = {}) => ({ id: id(n), period: "2026-2", projectCode: `VCM-2026-${n}`,
  campusName: "Maipú", subjectCode: "DSY1105", sectionCode: "001D", teamsJson: JSON.stringify(teams),
  completedAt: null, closedInternally: false, closedById: null, revoked: false,
  originalExpiresAt: new Date(Date.now() + 86400000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  evaluationsJson: JSON.stringify(Array.from({ length: evaluated }, (_, i) => evaluation(i))), ...overrides });

function harness(rows = [review(1, 2), review(2), review(3, 20, { completedAt: "2026-10-25T13:00:00Z" })]) {
  let state = { rows, writes: 0, audits: [], queries: [], milestones: { one: "COMPLETADO", two: "PENDIENTE", three: "PENDIENTE" } };
  class Request {
    constructor() { this.parameters = {}; }
    input(name, _type, value) { this.parameters[name] = value; return this; }
    async query(statement) {
      state.queries.push(statement);
      const p = this.parameters;
      if (statement.includes("SELECT codigo AS code")) return { recordset: [{ code: "2026-2" }] };
      if (statement.includes("SELECT p.proyecto_id")) {
        assert.match(statement, /UPDLOCK, HOLDLOCK/); return { recordset: [] };
      }
      if (statement.includes("AS evaluationsJson")) {
        assert.match(statement, /period.codigo = @period AND r.revocado_en IS NULL/);
        assert.match(statement, /ORDER BY e.equipo_id FOR JSON PATH/);
        return { recordset: state.rows.filter((r) => r.period === p.period && !r.revoked).map(({ period: _period, revoked: _revoked, ...row }) => structuredClone(row)) };
      }
      if (statement.includes("UPDATE r SET")) {
        assert.match(statement, /OPENJSON\(@targets\)/);
        assert.match(statement, /pa.codigo = @period AND r.revocado_en IS NULL/);
        assert.match(statement, /DATEADD\(second, -1, @closedAt\)/);
        assert.doesNotMatch(statement, /UPDATE.*(?:Hito|Avance)|DELETE|SET revocado_en/i);
        const targets = JSON.parse(p.targets);
        const closedAt = new Date().toISOString();
        const output = [];
        for (const r of state.rows) {
          if (r.period !== p.period || r.revoked || !targets.some((t) => t.id === r.id)) continue;
          r.originalExpiresAt = new Date(Math.min(Date.parse(r.originalExpiresAt), Date.now() - 1000)).toISOString();
          r.expiresAt = r.originalExpiresAt;
          if (!r.completedAt) { r.completedAt = closedAt; r.closedInternally = true; r.closedById = p.actorId; }
          state.writes++;
          output.push({ id: r.id, closedAt });
        }
        return { recordset: output };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    }
  }
  const filename = path.resolve(__dirname, "../src/repositories/partnerReviewBulkRepository.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, require: (name) => {
    if (name === "../lib/db") return { sql: { Request, UniqueIdentifier: "uuid", VarChar: () => "text", NVarChar: () => "text" },
      getPool: async () => ({ request: () => new Request() }), withTransaction: async (operation) => {
        const before = structuredClone(state);
        try { return await operation({}); } catch (error) { state = before; throw error; }
      } };
    if (name === "../lib/audit") return { writeAudit: async (_transaction, actor, event, options) => {
      assert.equal(options.required, true);
      if (state.failAudit) throw new Error("Auditoría no disponible");
      state.audits.push({ ...event, actor });
    } };
    return nativeRequire(name);
  } });
  return { repository: module.exports, get state() { return state; } };
}
async function preview(f) { return f.repository.previewBulkReviewClosure("2026-2", admin); }
const confirm = (p) => ({ period: p.period, generatedAt: p.generatedAt, revision: p.revision, confirmed: true, confirmation: p.period });

test("la vista previa no escribe y distingue respuestas parciales, ausentes y finalizadas", async () => {
  const f = harness();
  const p = await preview(f);
  assert.deepEqual(JSON.parse(JSON.stringify(p.summary)), { links: 3, withFeedback: 1, withoutFeedback: 1, alreadyCompleted: 1, evaluations: 22 });
  assert.equal(f.state.writes, 0); assert.equal(f.state.audits.length, 0);
  assert.equal(JSON.stringify(p).includes("Buena propuesta"), false);
  assert.equal(JSON.stringify(p).includes("token"), false);
});

test("el cierre conserva las evaluaciones, bloquea enlaces y registra todo sin modificar hitos", async () => {
  const f = harness();
  const p = await preview(f);
  const before = structuredClone(f.state.rows);
  const result = await f.repository.closeBulkPartnerReviews(confirm(p), admin);
  assert.equal(result.summary.links, 3);
  assert.equal(f.state.writes, 3);
  for (const r of f.state.rows) {
    assert.ok(Date.parse(r.expiresAt) < Date.now());
    assert.equal(r.evaluationsJson, before.find((b) => b.id === r.id).evaluationsJson);
    assert.equal(r.revoked, false, "internal feedback must stay discoverable");
  }
  const finished = f.state.rows[2];
  assert.equal(finished.completedAt, before[2].completedAt);
  assert.equal(finished.closedById, null); assert.equal(finished.closedInternally, false);
  const partial = f.state.rows[0];
  assert.ok(isFinalReviewFeedback({ ...partial, teams, evaluations: JSON.parse(partial.evaluationsJson) }));
  const empty = f.state.rows[1];
  assert.equal(isFinalReviewFeedback({ ...empty, teams, evaluations: [] }), false);
  assert.throws(() => assertFinalReviewFeedback({ ...empty, teams, evaluations: [] }), { code: "REVIEW_WITHOUT_EVALUATIONS" });
  assert.deepEqual(f.state.milestones, { one: "COMPLETADO", two: "PENDIENTE", three: "PENDIENTE" });
  assert.equal(f.state.audits.length, 1);
  const audit = f.state.audits[0];
  assert.equal(audit.action, "PARTNER_REVIEWS_BULK_CLOSED"); assert.equal(audit.actor.id, admin.id);
  assert.equal(audit.entityId, "2026-2"); assert.equal(audit.data.reviews.length, 3);
  assert.equal(audit.data.operationId, result.operationId); assert.equal(audit.data.closedAt, result.closedAt);
});

test("incluye pendientes vencidas, conserva finalizadas vencidas, revocadas y otros períodos", async () => {
  const expired = "2026-01-01T00:00:00Z";
  const f = harness([review(1, 2, { expiresAt: expired, originalExpiresAt: expired }),
    review(2, 20, { expiresAt: expired, completedAt: expired }), review(3, 2, { revoked: true }),
    review(4, 2, { period: "2026-1" })]);
  const before = structuredClone(f.state.rows.slice(1));
  const p = await preview(f);
  assert.equal(p.summary.links, 1);
  await f.repository.closeBulkPartnerReviews(confirm(p), admin);
  assert.equal(Date.parse(f.state.rows[0].expiresAt), Date.parse(expired));
  assert.deepEqual(f.state.rows.slice(1), before);
});

test("sólo el administrador puede listar períodos, previsualizar y cerrar", async () => {
  for (const actor of [null, { role: "teacher" }, { role: "coordinator", title: "Coordinador CITT" }]) {
    const f = harness();
    for (const call of [() => f.repository.listBulkReviewPeriods(actor), () => f.repository.previewBulkReviewClosure("2026-2", actor), () => f.repository.closeBulkPartnerReviews({}, actor)]) {
      await assert.rejects(call, { code: "ROLE_REQUIRED" });
    }
    assert.equal(f.state.queries.length, 0);
  }
});

test("no acepta confirmación incompleta, período incorrecto ni vista previa vencida", async () => {
  const f = harness(); const p = await preview(f);
  for (const overrides of [{ confirmed: false }, { confirmation: "2026-1" }]) {
    await assert.rejects(() => f.repository.closeBulkPartnerReviews({ ...confirm(p), ...overrides }, admin), { code: "BULK_CONFIRMATION_REQUIRED" });
  }
  for (const overrides of [{ generatedAt: "invalid" }, { generatedAt: "2020-01-01T00:00:00Z" }, { revision: "abc" }]) {
    await assert.rejects(() => f.repository.closeBulkPartnerReviews({ ...confirm(p), ...overrides }, admin), { code: "BULK_PREVIEW_CHANGED" });
  }
  await assert.rejects(() => f.repository.previewBulkReviewClosure("2026-2';DELETE", admin), { code: "INVALID_PERIOD" });
  assert.equal(f.state.writes, 0);
});

test("una respuesta editada, nueva revisión, revocación o cierre concurrente obliga a revisar otra vez", async () => {
  for (const mutate of [
    (s) => { const e = JSON.parse(s.rows[0].evaluationsJson); e[0].strengths = "Editada en el mismo segundo"; s.rows[0].evaluationsJson = JSON.stringify(e); },
    (s) => s.rows.push(review(4, 1)),
    (s) => { s.rows[0].revoked = true; },
    (s) => { s.rows[0].completedAt = new Date().toISOString(); },
  ]) {
    const f = harness(); const p = await preview(f); mutate(f.state);
    await assert.rejects(() => f.repository.closeBulkPartnerReviews(confirm(p), admin), { code: "BULK_PREVIEW_CHANGED" });
    assert.equal(f.state.writes, 0); assert.equal(f.state.audits.length, 0);
  }
});

test("si falla la auditoría se revierte todo el cierre; reintentar no duplica una operación confirmada", async () => {
  const f = harness(); const p = await preview(f); const before = structuredClone(f.state.rows);
  f.state.failAudit = true;
  await assert.rejects(() => f.repository.closeBulkPartnerReviews(confirm(p), admin), /Auditoría no disponible/);
  assert.deepEqual(f.state.rows, before); assert.equal(f.state.writes, 0);
  f.state.failAudit = false;
  await f.repository.closeBulkPartnerReviews(confirm(p), admin);
  await assert.rejects(() => f.repository.closeBulkPartnerReviews(confirm(p), admin), { code: "BULK_PREVIEW_CHANGED" });
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.writes, 3);
  assert.equal((await preview(f)).summary.links, 0);
});

test("rechaza respuestas ajenas al equipo antes de escribir", async () => {
  const f = harness([review(1, 0, { evaluationsJson: JSON.stringify([{ ...evaluation(), teamId: id(500) }]) })]);
  await assert.rejects(() => preview(f), { code: "REVIEW_INVALID_EVALUATIONS" });
  assert.equal(f.state.writes, 0);
});

test("las tres rutas exigen sesión de administrador antes de leer el cuerpo o llamar al repositorio", async () => {
  for (const actor of [null, { role: "teacher" }, { role: "coordinator" }, admin]) {
    const routes = new Map(); const calls = [];
    const filename = path.resolve(__dirname, "../src/functions/partnerReviewBulk.js");
    const nativeRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { require: (name) => {
      if (name === "@azure/functions") return { app: { http: (key, value) => routes.set(key, value) } };
      if (name === "../lib/auth") return { requireAdmin: async () => {
        if (!actor) throw new AppError(401, "AUTH_REQUIRED", "Sesión requerida");
        if (actor.role !== "admin") throw new AppError(403, "ROLE_REQUIRED", "Administración requerida");
        return actor;
      } };
      if (name.includes("Repository")) return Object.fromEntries(["listBulkReviewPeriods", "previewBulkReviewClosure", "closeBulkPartnerReviews"].map((key) => [key, async (...args) => { calls.push({ key, args }); return { done: true }; }]));
      return nativeRequire(name);
    } });
    let reads = 0;
    for (const route of routes.values()) {
      const response = await route.handler({ json: async () => { reads++; return { period: "2026-2" }; } });
      assert.equal(response.status, !actor ? 401 : actor.role !== "admin" ? 403 : 200);
      assert.equal(response.headers["Cache-Control"], "no-store");
    }
    assert.equal(calls.length, actor?.role === "admin" ? 3 : 0);
    assert.equal(reads, actor?.role === "admin" ? 2 : 0);
  }
});
