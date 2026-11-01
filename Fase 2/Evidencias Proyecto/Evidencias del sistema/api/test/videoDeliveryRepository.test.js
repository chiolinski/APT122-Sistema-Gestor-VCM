const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createReviewToken, hashReviewToken } = require("../src/lib/partnerReviews");
const { AppError } = require("../src/lib/http");

const id = (number) => `6f9619ff-8b86-d011-b42d-${String(number).padStart(12, "0")}`;
const token = createReviewToken();
function fixture() {
  let state = { active: true, published: false, writes: 0, verified: [], signed: [], failVerification: false, calls: [],
    delivery: { id: id(1), teamId: id(2), sectionId: id(3), projectCode: "VCM-2026-001", projectName: "Proyecto",
      teamName: "Equipo 1", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), deliveredAt: null, attemptId: null },
    access: { projectId: id(4), projectStatus: "EN_EJECUCION", milestoneOneStatus: "COMPLETADO", allMilestoneOneStatus: "COMPLETADO", available: true,
      campusName: "Concepción", subjectName: "Desarrollo de aplicaciones móviles", sectionCode: "001D" } };
  class Request {
    constructor() { this.p = {}; }
    input(name, _type, value) { this.p[name] = value; return this; }
    async query(sql) {
      state.calls.push({ sql, p: this.p });
      if (sql.includes("WHERE d.token_hash = @hash")) {
        assert.match(sql, /d.revocado_en IS NULL/);
        assert.match(sql, /team.seccion_id = d.seccion_id/);
        assert.match(sql, /p.estado = 'EN_EJECUCION'/);
        return { recordset: state.active && this.p.hash === hashReviewToken(token) ? [structuredClone(state.delivery)] : [] };
      }
      state.writes++;
      if (sql.includes("SET intento_id = @attemptId")) {
        state.delivery = { ...state.delivery, attemptId: this.p.attemptId, pendingBlob: this.p.blob, pendingName: this.p.name,
          expectedSize: this.p.size, attemptExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
        return { recordset: [{ expiresAt: state.delivery.attemptExpiresAt }] };
      }
      if (sql.includes("SET blob_confirmado = blob_pendiente")) {
        state.delivery.deliveredAt = new Date().toISOString(); state.delivery.filename = state.delivery.pendingName;
        return { recordset: [{ deliveredAt: state.delivery.deliveredAt, filename: state.delivery.filename }] };
      }
      if (sql.includes("INSERT vcm.EntregaVideoEquipo")) return { recordset: [{ expiresAt: state.delivery.expiresAt }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  }
  const filename = path.resolve(__dirname, "../src/repositories/videoDeliveryRepository.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, Date, require: (name) => {
    if (name === "../lib/db") return { sql: { Request, UniqueIdentifier: "uuid", BigInt: "bigint", Char: () => "text", NVarChar: () => "text" },
      getPool: async () => ({}), withTransaction: async (operation) => {
        const previous = structuredClone(state);
        try { return await operation({}); } catch (error) { state = previous; throw error; }
      } };
    if (name === "../lib/hitoTwoWorkflow") return {
      getHitoTwoAccess: async (_connection, code, sectionId) => { assert.equal(code, state.delivery.projectCode); assert.equal(sectionId, state.delivery.sectionId); return state.access; },
      assertHitoTwoOpen: nativeRequire(name).assertHitoTwoOpen,
      getSectionTeams: async () => [{ id: state.delivery.teamId, name: state.delivery.teamName }],
      getSectionFeedback: async () => state.published ? { id: id(5) } : null,
    };
    if (name === "../lib/videoUploads") return { ...nativeRequire(name),
      signVideoUpload: async (blobName, expiresAt) => { state.signed.push(blobName); return { url: "https://example.test/?sig=fake", expiresAt }; },
      verifyVideoUpload: async (blobName, size) => { state.verified.push({ blobName, size }); if (state.failVerification) throw new AppError(422, "VIDEO_UPLOAD_INVALID", "Archivo inválido"); },
    };
    if (name === "../lib/audit") return { writeAudit: async (_connection, _principal, event) => assert.ok(!JSON.stringify(event).includes(token)) };
    if (name === "../lib/config") return { getConfig: () => ({ videoUploadEnabled: true }) };
    return nativeRequire(name);
  } });
  return { repository: module.exports, get state() { return state; } };
}

test("el enlace de alumno sólo expone su equipo, sin destinos de almacenamiento ni secretos", async () => {
  const f = fixture();
  const result = await f.repository.getVideoDelivery(token);
  assert.equal(result.teamName, "Equipo 1"); assert.equal(result.open, true);
  for (const key of ["id", "teamId", "sectionId", "pendingBlob", "projectCode", "token_hash"]) assert.equal(result[key], undefined);
  await assert.rejects(f.repository.getVideoDelivery(createReviewToken()), { code: "VIDEO_DELIVERY_UNAVAILABLE" });
  f.state.active = false;
  await assert.rejects(f.repository.getVideoDelivery(token), { code: "VIDEO_DELIVERY_UNAVAILABLE" });
});

test("un alumno sube a un destino emitido por el servidor y sólo confirma tras verificar Azure", async () => {
  const f = fixture();
  const attempt = await f.repository.beginVideoUpload(token, { name: "video.mp4", size: 12, blobName: "otra-seccion/video.mp4" });
  assert.match(f.state.signed[0], /^concepcion\/desarrollo-aplicaciones-moviles\/001D\/Entrega-/);
  assert.equal(f.state.delivery.deliveredAt, null);
  const repeated = await f.repository.beginVideoUpload(token, { name: "video.mp4", size: 12 });
  assert.equal(repeated.attemptId, attempt.attemptId);
  await assert.rejects(f.repository.beginVideoUpload(token, { name: "otro.mp4", size: 12 }), { code: "VIDEO_UPLOAD_IN_PROGRESS" });
  await assert.rejects(f.repository.confirmVideoUpload(token, id(90)), { code: "VIDEO_UPLOAD_CHANGED" });
  f.state.failVerification = true;
  await assert.rejects(f.repository.confirmVideoUpload(token, attempt.attemptId), { code: "VIDEO_UPLOAD_INVALID" });
  assert.equal(f.state.delivery.deliveredAt, null);
  f.state.failVerification = false;
  const result = await f.repository.confirmVideoUpload(token, attempt.attemptId);
  assert.equal(result.filename, "video.mp4"); assert.ok(result.deliveredAt);
  assert.equal(f.state.verified.at(-1).blobName, f.state.signed[0]);
});

test("publicar la revisión bloquea nuevas cargas y confirmaciones aunque quede una SAS vigente", async () => {
  const f = fixture();
  const attempt = await f.repository.beginVideoUpload(token, { name: "video.mp4", size: 12 });
  f.state.published = true;
  assert.equal((await f.repository.getVideoDelivery(token)).open, false);
  const writes = f.state.writes;
  await assert.rejects(f.repository.beginVideoUpload(token, { name: "video.mp4", size: 12 }), { code: "VIDEO_DELIVERY_PUBLISHED" });
  await assert.rejects(f.repository.confirmVideoUpload(token, attempt.attemptId), { code: "VIDEO_DELIVERY_PUBLISHED" });
  assert.equal(f.state.writes, writes);
  assert.equal(f.state.delivery.deliveredAt, null);
});

test("los enlaces se renuevan sólo con el hito abierto y conservan las entregas existentes", async () => {
  const f = fixture();
  const links = await f.repository.createVideoDeliveryLinks("VCM-2026-001", id(3), { id: id(9), role: "teacher" });
  assert.equal(links.length, 1); assert.equal(links[0].token.length, 43);
  const sql = f.state.calls.find(({ sql }) => sql.includes("INSERT vcm.EntregaVideoEquipo")).sql;
  assert.match(sql, /previous.blob_confirmado/); assert.match(sql, /SET revocado_en/);
  f.state.access.milestoneTwoStatus = "COMPLETADO";
  await assert.rejects(f.repository.createVideoDeliveryLinks("VCM-2026-001", id(3), {}), { code: "HITO_TWO_LOCKED" });
});
