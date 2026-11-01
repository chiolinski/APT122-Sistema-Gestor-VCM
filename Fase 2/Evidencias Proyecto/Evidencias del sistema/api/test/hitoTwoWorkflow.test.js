const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { validateVideoUpload, signVideoUpload, verifyVideoUpload, VIDEO_MAX_BYTES } = require("../src/lib/videoUploads");
const id = (number) => `6f9619ff-8b86-d011-b42d-${String(number).padStart(12, "0")}`;

function fixture() {
  const state = { access: { projectId: id(1), projectStatus: "EN_EJECUCION", teacherAssigned: true,
    milestoneOneStatus: "COMPLETADO", allMilestoneOneStatus: "COMPLETADO", available: true },
    teams: [{ id: id(3), name: "Equipo 1" }], review: null, evaluations: [], calls: [], videoStatus: "available" };
  class Request {
    constructor() { this.inputs = {}; }
    input(key, _type, value) { this.inputs[key] = value; return this; }
    async query(sql) {
      state.calls.push({ sql, inputs: this.inputs });
      const rows = sql.includes("oneSection.estado") ? [state.access] : sql.includes("FROM vcm.Equipo") ? state.teams
        : sql.includes("FROM vcm.RevisionSocio") ? state.review ? [{ ...state.review, teamsJson: JSON.stringify(state.teams) }] : []
          : sql.includes("FROM vcm.EvaluacionSocioEquipo") ? state.evaluations : [];
      return { recordset: structuredClone(rows) };
    }
  }
  const filename = path.resolve(__dirname, "../src/lib/hitoTwoWorkflow.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, require: (name) => {
    if (name === "./db") return { sql: { Request, VarChar: () => "text", NVarChar: () => "text", UniqueIdentifier: "uuid" } };
    if (name === "./partnerVideos") return { resolvePartnerVideo: async () => ({ status: state.videoStatus }) };
    return nativeRequire(name);
  } });
  return { helper: module.exports, state };
}

test("sólo un docente asignado o administración pueden consultar una sección", async () => {
  const { helper, state } = fixture();
  const principal = { id: id(9), role: "teacher", canTeach: true };
  await helper.getHitoTwoAccess({}, "VCM-1", id(2), principal);
  assert.equal(state.calls[0].inputs.sectionId, id(2));
  assert.match(state.calls[0].sql, /ps.seccion_id = @sectionId/);
  assert.match(state.calls[0].sql, /ds.vigente = 1/);
  state.access.teacherAssigned = false;
  await assert.rejects(helper.getHitoTwoAccess({}, "VCM-1", id(2), principal), { code: "SECTION_ACCESS_DENIED" });
  await assert.rejects(helper.getHitoTwoAccess({}, "VCM-1", id(2), { ...principal, canTeach: false }), { code: "SECTION_ACCESS_DENIED" });
  await helper.getHitoTwoAccess({}, "VCM-1", id(2), { ...principal, role: "admin" });
});

test("la entrega requiere apertura, equipos y todos los videos; no completa hitos", async () => {
  const { helper, state } = fixture();
  const principal = { id: id(9), role: "teacher", canTeach: true };
  await helper.prepareVideoDelivery({}, "VCM-1", id(2), principal);
  assert.equal(state.calls.some(({ sql }) => /UPDATE|INSERT|MERGE/.test(sql)), false);
  state.videoStatus = "pending";
  await assert.rejects(helper.prepareVideoDelivery({}, "VCM-1", id(2), principal), { code: "HITO_TWO_VIDEOS_REQUIRED" });
  state.access.available = false;
  await assert.rejects(helper.prepareVideoDelivery({}, "VCM-1", id(2), principal), { code: "HITO_TWO_NOT_OPEN" });
  state.access.available = true; state.access.milestoneTwoStatus = "COMPLETADO";
  await assert.rejects(helper.prepareVideoDelivery({}, "VCM-1", id(2), principal), { code: "HITO_TWO_LOCKED" });
});

test("el cierre exige confirmación, evaluación final de todos los equipos y la revisión vigente", async () => {
  const { helper, state } = fixture();
  const input = { feedbackReviewed: true, reviewId: id(5) };
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), {}), { code: "FEEDBACK_ACK_REQUIRED" });
  assert.equal(state.calls.length, 0);
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), input), { code: "FEEDBACK_NOT_COMPLETED" });
  state.review = { id: id(5), completedAt: null };
  state.evaluations = [{ teamId: id(3), rating: 4 }];
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), input), { code: "FEEDBACK_NOT_COMPLETED" });
  state.review.completedAt = "2026-10-20T15:00:00Z";
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), { ...input, reviewId: id(6) }), { code: "FEEDBACK_CHANGED" });
  state.evaluations = [];
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), input), { code: "REVIEW_INCOMPLETE" });
  state.evaluations = [{ teamId: id(3), rating: 4 }];
  assert.equal((await helper.assertSectionFeedbackReviewed({}, id(1), id(2), input)).id, id(5));
  const query = state.calls.find(({ sql }) => sql.includes("FROM vcm.RevisionSocio"));
  assert.equal(query.inputs.sectionId, id(2));
  assert.match(query.sql, /UPDLOCK, HOLDLOCK/);
  assert.match(query.sql, /r.revocado_en IS NULL/);
  assert.match(query.sql, /r.socio_formador_id = p.socio_formador_id/);
});

test("tener todos los videos no habilita la publicación sin apertura de coordinación", async () => {
  const { helper, state } = fixture();
  state.access.available = false;
  state.videoStatus = "available";
  const principal = { id: id(9), role: "teacher", canTeach: true };
  await assert.rejects(helper.prepareVideoDelivery({}, "VCM-1", id(2), principal), { code: "HITO_TWO_NOT_OPEN" });
  const query = state.calls[0].sql;
  assert.match(query, /twoGlobal\.disponible_desde <= CONVERT\(date/);
  assert.match(query, /ELSE CAST\(0 AS bit\) END AS available/);
  assert.equal(state.calls.some(({ sql }) => /UPDATE|INSERT|MERGE/.test(sql)), false);
});

test("cerrar Hito 2 acepta retroalimentación parcial sólo si existe un cierre interno atribuible", async () => {
  const { helper, state } = fixture();
  state.teams.push({ id: id(4), name: "Equipo 2" });
  state.evaluations = [{ teamId: id(3), rating: 4 }];
  state.review = { id: id(5), completedAt: "2026-10-28T15:00:00Z" };
  const input = { feedbackReviewed: true, reviewId: id(5) };
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), input), { code: "REVIEW_INCOMPLETE" });
  state.review.closedInternally = true; state.review.closedById = id(9);
  assert.equal((await helper.assertSectionFeedbackReviewed({}, id(1), id(2), input)).evaluations.length, 1);
  state.evaluations = [];
  await assert.rejects(helper.assertSectionFeedbackReviewed({}, id(1), id(2), input), { code: "REVIEW_WITHOUT_EVALUATIONS" });
});

test("cambiar equipos o el video entregado invalida el resumen anterior", () => {
  const { helper } = fixture();
  const team = { id: id(3), name: "Equipo 1", videoBlobName: "video-original" };
  assert.equal(helper.samePublishedTeams([team], [team]), true);
  for (const updated of [{ ...team, id: id(4) }, { ...team, name: "Equipo 2" }, { ...team, videoBlobName: "otro" }]) {
    assert.equal(helper.samePublishedTeams([updated], [team]), false);
  }
  assert.equal(helper.samePublishedTeams([], []), false);
});

test("la carga valida nombre y tamaño, sin aceptar destinos aportados por alumnos", () => {
  assert.deepEqual(validateVideoUpload({ name: "video.mp4", size: 12, blobName: "otro/equipo" }), { name: "video.mp4", size: 12 });
  for (const name of ["../video.mp4", "video.exe", "video\u0000.mp4", ""]) assert.throws(() => validateVideoUpload({ name, size: 12 }));
  for (const size of [0, -1, 1.5, VIDEO_MAX_BYTES + 1]) assert.throws(() => validateVideoUpload({ name: "video.mp4", size }));
});

const blob = `concepcion/desarrollo-aplicaciones-moviles/001D/Entrega-${id(3)}-${id(4)}.mp4`;
const config = { videoUploadEnabled: true, videoAccountUrl: "http://127.0.0.1:10000/devstoreaccount1", videoContainerName: "vcm-local-videos" };
test("el permiso de carga sólo crea un blob por HTTPS y vence en quince minutos", async () => {
  let signed;
  const storage = { getBlobClient: (name) => ({ name }), sign: async (client, options) => { signed = { client, options }; return "https://example.test/?sig=fake"; } };
  await signVideoUpload(blob, new Date(Date.now() + 3_600_000).toISOString(), { config, storage });
  assert.equal(signed.client.name, blob);
  assert.equal(signed.options.permissions.toString(), "c");
  assert.equal(signed.options.protocol, "https,http");
  assert.ok(signed.options.expiresOn.getTime() - Date.now() <= 15 * 60_000);
  await assert.rejects(signVideoUpload(blob, "2000-01-01T00:00:00Z", { config, storage }), { code: "VIDEO_UPLOAD_EXPIRED" });
  await assert.rejects(signVideoUpload(blob, new Date(Date.now() + 60_000).toISOString(), { config: { ...config, videoUploadEnabled: false }, storage }), { code: "VIDEO_UPLOAD_NOT_CONFIGURED" });
});

test("la confirmación lee propiedades y cabecera MP4; rechaza archivos distintos o falsos", async () => {
  const header = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
  let properties = { contentLength: 12, contentType: "video/mp4" };
  let bytes = header;
  const storage = { getBlobClient: () => ({ getProperties: async () => properties, downloadToBuffer: async () => bytes }) };
  await verifyVideoUpload(blob, 12, { config, storage });
  properties = { ...properties, contentLength: 13 };
  await assert.rejects(verifyVideoUpload(blob, 12, { config, storage }), { code: "VIDEO_UPLOAD_INVALID" });
  properties = { contentLength: 12, contentType: "text/html" };
  await assert.rejects(verifyVideoUpload(blob, 12, { config, storage }), { code: "VIDEO_UPLOAD_INVALID" });
  properties.contentType = "video/mp4"; bytes = Buffer.from("not an mp4!!");
  await assert.rejects(verifyVideoUpload(blob, 12, { config, storage }), { code: "VIDEO_UPLOAD_INVALID" });
});
