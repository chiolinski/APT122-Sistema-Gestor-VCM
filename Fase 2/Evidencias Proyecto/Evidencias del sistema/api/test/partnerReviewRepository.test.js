const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const { hashReviewToken, createReviewToken } = require("../src/lib/partnerReviews");

const id = (number) => `6f9619ff-8b86-d011-b42d-${String(number).padStart(12, "0")}`;
const principal = { id: id(90), role: "coordinator", title: "Coordinador CITT", name: "Coordinador de prueba", email: "coordinator@example.test" };
const token = createReviewToken();

function harness() {
  const context = { projectId: id(1), projectCode: "VCM-2026-001", projectName: "Proyecto", partnerId: id(2),
    partnerName: "Organización", contactName: "Contacto", sectionCode: "001D", campusName: "Sede", subjectName: "Asignatura", period: "2026-2", teacherName: "Docente" };
  let state = {
    allowed: true, contextAllowed: true, currentToken: hashReviewToken(token),
    invitation: { id: id(10), teamsJson: JSON.stringify([{ id: id(20), name: "Equipo 1", videoUrl: null }]), completedAt: null,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 21 * 86400000).toISOString(),
      closedInternally: false, closedById: null, projectCode: context.projectCode, sectionId: id(3) },
    evaluations: [], teams: [{ id: id(20), name: "Equipo 1" }], writes: 0, audits: [], videoCalls: [], queries: [],
  };
  class Request {
    constructor() { this.parameters = {}; }
    input(name, _type, value) { this.parameters[name] = value; return this; }
    async query(statement) {
      const p = this.parameters;
      state.queries.push(statement);
      const result = (rows) => ({ recordset: structuredClone(rows) });
      if (statement.includes("r.token_hash = @hash")) {
        assert.match(statement, /r.revocado_en IS NULL AND r.vence_en > SYSUTCDATETIME/);
        assert.match(statement, /p.socio_formador_id = r.socio_formador_id/);
        assert.match(statement, /ps.seccion_id = r.seccion_id/);
        assert.match(statement, /DATEADD\(day, 21, r.creado_en\) > SYSUTCDATETIME/);
        const available = Math.min(Date.parse(state.invitation.expiresAt), Date.parse(state.invitation.createdAt) + 21 * 86400000) > Date.now();
        return result(state.allowed && available && state.currentToken === p.hash ? [state.invitation] : []);
      }
      if (statement.includes("oneSection.estado AS milestoneOneStatus")) return result([{ ...context, teacherAssigned: true, projectStatus: "EN_EJECUCION", milestoneOneStatus: "COMPLETADO", allMilestoneOneStatus: "COMPLETADO", available: true, ...state.accessOverrides }]);
      if (statement.includes("SELECT TOP (1)") && statement.includes("FROM vcm.RevisionSocio")) return result(state.allowed ? [state.invitation] : []);
      if (statement.includes("FROM vcm.RevisionSocio r") && statement.includes("AS closureContext")) return result([{ ...state.invitation,
        closureContext: state.allowed, teacherAssigned: state.accessOverrides?.teacherAssigned ?? true,
        active: state.allowed && Date.parse(state.invitation.expiresAt) > Date.now(), ...state.listOverrides }]);
      if (statement.includes("period.codigo = '2026-2'")) {
        assert.equal(p.sectionId, id(3));
        assert.match(statement, /section.activa = 1/);
        assert.match(statement, /partner.activo = 1/);
        return result(state.contextAllowed ? [context] : []);
      }
      if (statement.includes("FROM vcm.EvaluacionSocioEquipo WHERE")) return result(state.evaluations);
      if (statement.includes("FROM vcm.Equipo")) return result(state.teams);
      if (statement.includes("INSERT INTO vcm.RevisionSocio")) {
        assert.match(statement, /DATEADD\(day, 21, SYSUTCDATETIME\(\)\)/);
        state.writes += 1;
        state.currentToken = p.hash;
        state.invitation.teamsJson = p.teams;
        state.invitation.completedAt = null;
        state.invitation.closedInternally = false; state.invitation.closedById = null;
        state.invitation.createdAt = new Date().toISOString();
        state.invitation.expiresAt = new Date(Date.now() + 21 * 86400000).toISOString();
        state.evaluations = [];
        assert.equal(p.partnerId, context.partnerId);
        return result([{ id: state.invitation.id, expiresAt: state.invitation.expiresAt }]);
      }
      if (statement.includes("MERGE vcm.EvaluacionSocioEquipo")) {
        state.writes += 1;
        const saved = { teamId: p.teamId, strengths: p.strengths, improvements: p.improvements, rating: p.rating, reviewedAt: "2026-10-15T12:00:00Z" };
        state.evaluations = [...state.evaluations.filter((item) => item.teamId !== p.teamId), saved];
        return result([saved]);
      }
      if (statement.includes("SET completado_en = SYSUTCDATETIME")) {
        state.writes += 1; state.invitation.completedAt = "2026-10-15T12:00:00Z";
        if (statement.includes("cierre_interno = 1")) {
          assert.match(statement, /completado_en IS NULL AND revocado_en IS NULL/);
          state.invitation.closedInternally = true; state.invitation.closedById = p.actorId;
          state.invitation.closedByName = principal.name;
        }
        return result([{ completedAt: state.invitation.completedAt }]);
      }
      if (statement.includes("UPDATE r SET revocado_en")) {
        state.writes += 1; state.allowed = false; return { rowsAffected: [1] };
      }
      throw new Error(`Consulta no prevista: ${statement}`);
    }
  }
  const filename = path.resolve(__dirname, "../src/repositories/partnerReviewRepository.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const mockRequire = (name) => {
    if (name === "../lib/db") return { sql: { Request, UniqueIdentifier: "uuid", NVarChar: () => "text", VarChar: () => "text", Char: () => "text", TinyInt: "int" },
      getPool: async () => ({ request: () => new Request() }), withTransaction: async (operation) => {
        const previous = structuredClone(state);
        try { return await operation({}); } catch (error) { state = previous; throw error; }
      } };
    if (name === "../lib/audit") return { writeAudit: async (_connection, _principal, event, options) => {
      if (state.failAudit) throw new Error("Auditoría no disponible");
      state.audits.push({ ...event, actorId: _principal.id, auditRequired: Boolean(options?.required) });
    } };
    if (name === "../lib/partnerVideos") return { resolvePartnerVideo: async (videoContext, team, videoOptions) => {
      state.videoCalls.push({ context: videoContext, team, options: videoOptions }); return { status: "available", url: "https://example.test/video.mp4" };
    } };
    if (name === "../lib/hitoTwoWorkflow") {
      const helperFile = path.resolve(__dirname, "../src/lib/hitoTwoWorkflow.js");
      const helper = { exports: {} };
      const helperRequire = createRequire(helperFile);
      vm.runInNewContext(fs.readFileSync(helperFile, "utf8"), { module: helper, require: (dependency) => {
        if (dependency === "./db") return mockRequire("../lib/db");
        if (dependency === "./partnerVideos") return mockRequire("../lib/partnerVideos");
        return helperRequire(dependency);
      } });
      return helper.exports;
    }
    return nativeRequire(name);
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, require: mockRequire });
  return { repository: module.exports, get state() { return state; } };
}

test("retoma respuestas persistidas y sólo entrega el contexto necesario", async () => {
  const fixture = harness();
  await fixture.repository.savePartnerEvaluation(token, id(20), { strengths: "Fortalezas", improvements: "Mejoras", rating: 4 });
  const review = await fixture.repository.getPartnerReview(token);
  assert.equal(review.evaluations[0].rating, 4);
  assert.equal(review.teams.length, 1);
  for (const field of ["projectId", "partnerId", "sectionId", "teamsJson", "token_hash", "currentToken"]) assert.equal(review[field], undefined);
  await fixture.repository.savePartnerEvaluation(token, id(20), { strengths: "Corrección", improvements: "Mejoras", rating: 5 });
  assert.equal(fixture.state.evaluations.length, 1);
  assert.equal(fixture.state.evaluations[0].strengths, "Corrección");
});

test("la búsqueda de videos usa sólo el contexto y los equipos autorizados por el enlace", async () => {
  const fixture = harness();
  await assert.rejects(fixture.repository.getPartnerReviewVideo(token, id(21)), { code: "REVIEW_TEAM_NOT_FOUND" });
  await assert.rejects(fixture.repository.getPartnerReviewVideo(createReviewToken(), id(20)), { code: "REVIEW_UNAVAILABLE" });
  assert.equal(fixture.state.videoCalls.length, 0);
  await fixture.repository.getPartnerReviewVideo(token, id(20));
  assert.equal(fixture.state.videoCalls[0].context.sectionCode, "001D");
  assert.equal(fixture.state.videoCalls[0].team.id, id(20));
  assert.equal(fixture.state.videoCalls[0].options.reviewExpiresAt, fixture.state.invitation.expiresAt);
  fixture.state.allowed = false;
  await assert.rejects(fixture.repository.getPartnerReviewVideo(token, id(20)), { code: "REVIEW_UNAVAILABLE" });
  assert.equal(fixture.state.videoCalls.length, 1);
  assert.equal(fixture.state.writes, 0);
});

test("enlaces inválidos o contextos desactivados no leen ni escriben evaluaciones", async () => {
  const fixture = harness();
  await assert.rejects(fixture.repository.getPartnerReview(createReviewToken()), { code: "REVIEW_UNAVAILABLE" });
  fixture.state.allowed = false;
  await assert.rejects(fixture.repository.savePartnerEvaluation(token, id(20), {}), { code: "REVIEW_UNAVAILABLE" });
  fixture.state.allowed = true; fixture.state.contextAllowed = false;
  await assert.rejects(fixture.repository.completePartnerReview(token), { code: "REVIEW_CONTEXT_NOT_FOUND" });
  assert.equal(fixture.state.writes, 0);
});

test("rechaza equipos de otros enlaces y exige respuestas completas antes del cierre", async () => {
  const fixture = harness();
  await assert.rejects(fixture.repository.savePartnerEvaluation(token, id(21), {}), { code: "REVIEW_TEAM_NOT_FOUND" });
  await assert.rejects(fixture.repository.completePartnerReview(token), { code: "REVIEW_INCOMPLETE" });
  assert.equal(fixture.state.writes, 0);
  await fixture.repository.savePartnerEvaluation(token, id(20), { strengths: "Fortalezas", improvements: "Mejoras", rating: 3 });
  const result = await fixture.repository.completePartnerReview(token);
  const writes = fixture.state.writes;
  assert.equal((await fixture.repository.completePartnerReview(token)).completedAt, result.completedAt);
  assert.equal(fixture.state.writes, writes);
  await assert.rejects(fixture.repository.savePartnerEvaluation(token, id(20), {}), { code: "REVIEW_COMPLETED" });
});

test("crear verifica los videos, publica equipos y sustituye el secreto anterior sin auditarlo", async () => {
  const fixture = harness();
  const result = await fixture.repository.createPartnerReview("VCM-2026-001", id(3), principal);
  assert.equal(fixture.state.currentToken, hashReviewToken(result.token));
  assert.notEqual(result.token, token);
  assert.equal(JSON.parse(fixture.state.invitation.teamsJson)[0].videoUrl, null);
  assert.ok(!JSON.stringify(fixture.state.audits).includes(result.token));
  assert.ok(!JSON.stringify(fixture.state.audits).includes(fixture.state.currentToken));
  await assert.rejects(fixture.repository.getPartnerReview(token), { code: "REVIEW_UNAVAILABLE" });
});

test("no publica secciones sin equipos y la revocación conserva respuestas", async () => {
  const fixture = harness();
  fixture.state.teams = [];
  await assert.rejects(fixture.repository.createPartnerReview("VCM-2026-001", id(3), principal), { code: "REVIEW_WITHOUT_TEAMS" });
  assert.equal(fixture.state.writes, 0);
  await fixture.repository.savePartnerEvaluation(token, id(20), { strengths: "Fortalezas", improvements: "Mejoras", rating: 4 });
  await fixture.repository.revokePartnerReview("VCM-2026-001", id(10), principal);
  await assert.rejects(fixture.repository.getPartnerReview(token), { code: "REVIEW_UNAVAILABLE" });
  assert.equal(fixture.state.evaluations.length, 1);
});

test("el resumen docente oculta comentarios parciales y muestra sólo la revisión final de su sección", async () => {
  const f = harness();
  await f.repository.savePartnerEvaluation(token, id(20), { strengths: "Final", improvements: "Mejora", rating: 4 });
  const partial = await f.repository.getHitoTwoState("VCM-2026-001", id(3), principal);
  assert.equal(partial.review.evaluatedCount, 1);
  assert.equal(partial.feedbackReady, false);
  assert.equal(partial.review.evaluations.length, 0);
  await f.repository.completePartnerReview(token);
  const final = await f.repository.getHitoTwoState("VCM-2026-001", id(3), principal);
  assert.equal(final.review.evaluations[0].strengths, "Final");
  assert.equal(final.feedbackReady, true);
  assert.equal(f.state.writes, 2, "reading summaries never completes a milestone");
});

test("un Hito 2 histórico cerrado no se reabre ni recibe una revisión nueva por mostrar el resumen", async () => {
  const f = harness();
  f.state.accessOverrides = { milestoneTwoStatus: "COMPLETADO", closedReviewId: null };
  const result = await f.repository.getHitoTwoState("VCM-2026-001", id(3), principal);
  assert.equal(result.closed, true); assert.equal(result.review, null);
  assert.equal(result.canPublish, false); assert.equal(result.canReceiveVideos, false);
  assert.equal(f.state.writes, 0);
});

const teacher = { id: id(91), role: "teacher", canTeach: true, email: "teacher@example.test", name: "Docente" };
function publishThree(f) {
  f.state.teams = [20, 21, 22].map((n) => ({ id: id(n), name: `Equipo ${n - 19}` }));
  f.state.invitation.teamsJson = JSON.stringify(f.state.teams);
}

test("el docente cierra dos de tres evaluaciones y habilita el resumen, pero no completa Hito 2 ni inventa notas", async () => {
  const f = harness(); publishThree(f);
  for (const n of [20, 21]) await f.repository.savePartnerEvaluation(token, id(n), { strengths: "Final", improvements: "Mejora", rating: n === 20 ? 4 : 2 });
  assert.equal((await f.repository.getHitoTwoState("VCM-2026-001", id(3), teacher)).canCloseReview, true);
  const result = await f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher);
  assert.equal(result.evaluatedCount, 2); assert.equal(result.totalTeams, 3);
  const state = await f.repository.getHitoTwoState("VCM-2026-001", id(3), teacher);
  assert.equal(state.closed, false); assert.equal(state.feedbackReady, true);
  assert.equal(state.review.closedInternally, true);
  assert.equal(state.review.evaluations.length, 2); assert.equal(state.review.teams.length, 3);
  assert.equal(state.canCloseReview, false);
  assert.equal(f.state.invitation.closedById, teacher.id);
  assert.equal(f.state.audits.at(-1).action, "PARTNER_REVIEW_CLOSED_INTERNALLY");
  assert.equal(f.state.audits.at(-1).actorId, teacher.id);
  assert.equal(f.state.audits.at(-1).auditRequired, true);
  assert.equal(f.state.audits.at(-1).data.unevaluatedCount, 1);
  assert.equal(f.state.queries.some((sql) => /UPDATE\s+vcm\.(?:HitoProyecto|AvanceProyecto)/i.test(sql)), false);
  const writes = f.state.writes;
  await f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher);
  assert.equal(f.state.writes, writes, "repeat closure is idempotent");
  const publicReview = await f.repository.getPartnerReview(token);
  assert.equal(publicReview.closedInternally, true);
  assert.equal(publicReview.closedById, undefined, "do not expose staff identities to the token");
  await assert.rejects(f.repository.savePartnerEvaluation(token, id(22), { strengths: "Nueva", improvements: "Nueva", rating: 1 }), { code: "REVIEW_COMPLETED" });
});

test("el vencimiento no finaliza automáticamente; coordinador CITT puede cerrar después de vencer con una evaluación", async () => {
  const f = harness(); publishThree(f);
  await f.repository.savePartnerEvaluation(token, id(20), { strengths: "Final", improvements: "Mejora", rating: 4 });
  f.state.invitation.createdAt = new Date(Date.now() - 22 * 86400000).toISOString();
  f.state.invitation.expiresAt = new Date(Date.now() + 60 * 86400000).toISOString(); // legacy ninety-day link
  for (const operation of [() => f.repository.getPartnerReview(token), () => f.repository.getPartnerReviewVideo(token, id(20)),
    () => f.repository.savePartnerEvaluation(token, id(21), {}), () => f.repository.completePartnerReview(token)]) {
    await assert.rejects(operation(), { code: "REVIEW_UNAVAILABLE" });
  }
  assert.equal(f.state.invitation.completedAt, null);
  f.state.accessOverrides = { teacherAssigned: false };
  await f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), { ...principal, canTeach: false });
  assert.equal(f.state.invitation.closedInternally, true);
  assert.equal(f.state.evaluations.length, 1);
});

test("el cierre interno rechaza cero evaluaciones, revisiones sustituidas/revocadas y cambios de equipos", async () => {
  const f = harness(); publishThree(f);
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher), { code: "REVIEW_WITHOUT_EVALUATIONS" });
  assert.equal(f.state.writes, 0);
  await f.repository.savePartnerEvaluation(token, id(20), { strengths: "Final", improvements: "Mejora", rating: 4 });
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(11), teacher), { code: "FEEDBACK_CHANGED" });
  f.state.allowed = false;
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher), { code: "FEEDBACK_CHANGED" });
  f.state.allowed = true; f.state.teams[0].name = "Equipo cambiado";
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher), { code: "REVIEW_TEAMS_CHANGED" });
  assert.equal(f.state.invitation.completedAt, null);
});

test("permisos y apertura se validan antes del cierre; la auditoría y el cierre son atómicos", async () => {
  const f = harness();
  for (const actor of [null, { role: "admin" }, { role: "coordinator", title: "Director de Carrera" }]) {
    await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), actor), { code: "REVIEW_CLOSE_ACCESS_DENIED" });
  }
  f.state.accessOverrides = { teacherAssigned: false };
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher), { code: "SECTION_ACCESS_DENIED" });
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), { ...principal, title: "Director de Carrera", canTeach: true }), { code: "REVIEW_CLOSE_ACCESS_DENIED" });
  f.state.accessOverrides = { teacherAssigned: true, available: false };
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), teacher), { code: "HITO_TWO_NOT_OPEN" });
  f.state.accessOverrides = { milestoneTwoStatus: "COMPLETADO" };
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), principal), { code: "HITO_TWO_LOCKED" });
  f.state.accessOverrides = {};
  await f.repository.savePartnerEvaluation(token, id(20), { strengths: "Final", improvements: "Mejora", rating: 4 });
  f.state.failAudit = true;
  await assert.rejects(f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), principal), /Auditoría no disponible/);
  assert.equal(f.state.invitation.completedAt, null);
  assert.equal(f.state.invitation.closedById, null);
  assert.equal(f.state.writes, 1);
});

test("el panel coordinador permite el cierre de una invitación vencida, nunca de una revocada ni a un administrador", async () => {
  const f = harness();
  await f.repository.savePartnerEvaluation(token, id(20), { strengths: "Final", improvements: "Mejora", rating: 4 });
  f.state.invitation.expiresAt = "2000-01-01T00:00:00Z";
  const reviews = await f.repository.listPartnerReviews("VCM-2026-001", principal);
  assert.equal(reviews[0].active, false); assert.equal(reviews[0].canClose, true);
  assert.equal((await f.repository.listPartnerReviews("VCM-2026-001", { ...principal, role: "admin" }))[0].canClose, false);
  f.state.allowed = false;
  assert.equal((await f.repository.listPartnerReviews("VCM-2026-001", principal))[0].canClose, false);
});

test("una sección de veinte equipos puede cerrarse con tres respuestas sin alterar las otras diecisiete", async () => {
  const f = harness();
  f.state.teams = Array.from({ length: 20 }, (_, i) => ({ id: id(20 + i), name: `Equipo ${i + 1}` }));
  f.state.invitation.teamsJson = JSON.stringify(f.state.teams);
  for (const n of [20, 29, 39]) await f.repository.savePartnerEvaluation(token, id(n), { strengths: "Fortaleza", improvements: "Mejora", rating: 4 });
  await f.repository.closeSectionPartnerReview("VCM-2026-001", id(3), id(10), principal);
  const state = await f.repository.getHitoTwoState("VCM-2026-001", id(3), teacher);
  assert.equal(state.feedbackReady, true); assert.equal(state.closed, false);
  assert.equal(state.review.teams.length, 20); assert.equal(state.review.evaluations.length, 3);
  assert.equal(f.state.audits.at(-1).data.unevaluatedCount, 17);
});
