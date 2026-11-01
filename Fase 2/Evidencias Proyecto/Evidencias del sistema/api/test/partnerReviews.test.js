const test = require("node:test");
const assert = require("node:assert/strict");
const { assertReviewComplete, assertReviewTeam, assertReviewWritable, createReviewToken, hashReviewToken, readReviewToken, validateReviewInput } = require("../src/lib/partnerReviews");
const { REVIEW_LINK_DAYS, canCloseReview, assertReviewHasFeedback, isFinalReviewFeedback } = require("../src/lib/partnerReviews");

const teamId = "6f9619ff-8b86-d011-b42d-000000000001";
const otherId = "6f9619ff-8b86-d011-b42d-000000000002";

test("genera secretos independientes y sólo deriva hashes deterministas", () => {
  const tokens = Array.from({ length: 30 }, createReviewToken);
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(hashReviewToken(token), /^[a-f0-9]{64}$/);
    assert.notEqual(token, hashReviewToken(token));
    assert.equal(hashReviewToken(token), hashReviewToken(token));
  }
});

test("rechaza tokens ausentes o malformados, conserva compatibilidad Bearer y no lee parámetros", () => {
  for (const token of [null, undefined, "", "demo", "a".repeat(44), "?".repeat(43), {}]) {
    assert.throws(() => hashReviewToken(token), { code: "REVIEW_UNAVAILABLE" });
  }
  const token = createReviewToken();
  assert.equal(readReviewToken({ headers: new Headers({ Authorization: `Bearer ${token}` }) }), token);
  assert.equal(readReviewToken({ headers: new Headers(), url: `https://example.test/?token=${token}` }), "");
});

test("valida y normaliza comentarios sin aceptar campos de contexto", () => {
  assert.deepEqual(validateReviewInput({ strengths: "  Útil para la comunidad  ", improvements: " Sin observaciones ", rating: 5, sectionId: otherId, reviewedAt: "2000-01-01" }),
    { strengths: "Útil para la comunidad", improvements: "Sin observaciones", rating: 5 });
  for (const payload of [null, {}, { strengths: " ", improvements: "Texto", rating: 3 }, { strengths: "Texto", improvements: "x".repeat(4001), rating: 3 }]) {
    assert.throws(() => validateReviewInput(payload), { code: "INVALID_REVIEW_TEXT" });
  }
  for (const rating of [0, 6, -1, 2.5, "4", null, NaN]) {
    assert.throws(() => validateReviewInput({ strengths: "Fortalezas", improvements: "Mejoras", rating }), { code: "INVALID_REVIEW_RATING" });
  }
});

test("el encabezado propio conserva la clave aunque Azure sustituya Authorization", () => {
  const token = createReviewToken();
  const headers = new Headers({ "X-VCM-Link-Token": token, Authorization: "Bearer azure-platform-token" });
  assert.equal(readReviewToken({ headers }), token);
  assert.equal(hashReviewToken(readReviewToken({ headers })), hashReviewToken(token));
});

test("un encabezado propio inválido no se sustituye por otra credencial ni por parámetros", () => {
  const token = createReviewToken();
  for (const value of ["", "invalido", `${token},${token}`]) {
    const headers = new Headers({ "X-VCM-Link-Token": value, Authorization: `Bearer ${token}` });
    assert.throws(() => hashReviewToken(readReviewToken({ headers })), { code: "REVIEW_UNAVAILABLE" });
  }
  assert.equal(readReviewToken({ headers: new Headers(), url: `https://example.test/?token=${token}` }), "");
});

test("impide evaluar equipos externos y modificar una revisión finalizada", () => {
  assert.doesNotThrow(() => assertReviewTeam([{ id: teamId }], teamId.toUpperCase()));
  for (const value of [otherId, "invalid", null]) assert.throws(() => assertReviewTeam([{ id: teamId }], value), { code: "REVIEW_TEAM_NOT_FOUND" });
  assert.throws(() => assertReviewWritable({ completedAt: "2026-10-15T10:00:00Z" }), { code: "REVIEW_COMPLETED" });
  assert.doesNotThrow(() => assertReviewWritable({ completedAt: null }));
});

test("finalizar requiere respuestas de todos los equipos publicados", () => {
  const teams = [{ id: teamId }, { id: otherId }];
  assert.throws(() => assertReviewComplete([], []), { code: "REVIEW_INCOMPLETE" });
  assert.throws(() => assertReviewComplete(teams, [{ teamId }, { teamId }]), { code: "REVIEW_INCOMPLETE" });
  assert.doesNotThrow(() => assertReviewComplete(teams, [{ teamId: teamId.toUpperCase() }, { teamId: otherId }]));
});

test("el cierre interno admite docentes asignados y coordinadores CITT, no otros roles sin docencia en la sección", () => {
  assert.equal(REVIEW_LINK_DAYS, 21);
  for (const principal of [null, { role: "admin" }, { role: "teacher", canTeach: false },
    { role: "coordinator", title: "Director de Carrera", canTeach: false }]) {
    assert.equal(canCloseReview(principal, true), false);
  }
  assert.equal(canCloseReview({ role: "teacher", canTeach: true }, false), false);
  assert.equal(canCloseReview({ role: "teacher", canTeach: true }, true), true);
  assert.equal(canCloseReview({ role: "coordinator", title: "Coordinador CITT", canTeach: false }), true);
  assert.equal(canCloseReview({ role: "coordinator", title: "Director de Carrera", canTeach: true }, false), false);
  assert.equal(canCloseReview({ role: "coordinator", title: "Director de Carrera", canTeach: true }, true), true);
});

test("la retroalimentación parcial requiere cierre interno atribuible y al menos una respuesta del conjunto publicado", () => {
  const teams = [{ id: teamId }, { id: otherId }];
  const review = { teams, evaluations: [{ teamId, rating: 4 }], completedAt: "2026-10-28T12:00:00Z" };
  assert.equal(isFinalReviewFeedback(review), false);
  assert.equal(isFinalReviewFeedback({ ...review, closedInternally: true }), false);
  assert.equal(isFinalReviewFeedback({ ...review, closedInternally: true, closedById: otherId }), true);
  assert.equal(isFinalReviewFeedback({ ...review, closedInternally: true, closedById: otherId, completedAt: null }), false);
  assert.throws(() => assertReviewHasFeedback(teams, []), { code: "REVIEW_WITHOUT_EVALUATIONS" });
  assert.throws(() => assertReviewHasFeedback(teams, [{ teamId: "foreign" }]), { code: "REVIEW_INVALID_EVALUATIONS" });
  assert.throws(() => assertReviewHasFeedback(teams, [{ teamId }, { teamId }]), { code: "REVIEW_INVALID_EVALUATIONS" });
});
