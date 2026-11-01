const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const { AppError } = require("../src/lib/http");
const { createReviewToken } = require("../src/lib/partnerReviews");

function endpoints(principal) {
  const registered = new Map();
  const calls = [];
  const repository = Object.fromEntries(["createPartnerReview", "getPartnerReview", "getPartnerReviewVideo", "listPartnerReviews", "revokePartnerReview", "savePartnerEvaluation", "completePartnerReview"]
    .map((name) => [name, async (...args) => { calls.push({ name, args }); return { saved: true }; }]));
  const filename = path.resolve(__dirname, "../src/functions/partnerReviews.js");
  const nativeRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { require: (name) => {
    if (name === "@azure/functions") return { app: { http: (key, options) => registered.set(key, options) } };
    if (name === "../lib/auth") return { requireRole: async (_request, roles) => {
      if (!principal) throw new AppError(401, "AUTH_REQUIRED", "Sesión requerida");
      if (!roles.includes(principal.role)) throw new AppError(403, "ROLE_REQUIRED", "Rol no permitido");
      return principal;
    } };
    if (name === "../repositories/partnerReviewRepository") return repository;
    return nativeRequire(name);
  } });
  return { registered, calls };
}

test("crear, listar y revocar enlaces exige sesión administrativa o de coordinación", async () => {
  for (const principal of [null, { role: "teacher" }]) {
    const fixture = endpoints(principal);
    for (const [name, method] of [["managePartnerReviews", "GET"], ["managePartnerReviews", "POST"], ["revokePartnerReview", "DELETE"]]) {
      const response = await fixture.registered.get(name).handler({ method, params: { id: "VCM-2026-001", reviewId: "review" }, json: async () => ({ sectionId: "section" }) });
      assert.equal(response.status, principal ? 403 : 401);
    }
    assert.equal(fixture.calls.length, 0);
  }
  for (const role of ["admin", "coordinator"]) {
    const fixture = endpoints({ role });
    const response = await fixture.registered.get("managePartnerReviews").handler({ method: "GET", params: { id: "VCM-2026-001" } });
    assert.equal(response.status, 200);
    assert.equal(fixture.calls[0].name, "listPartnerReviews");
  }
});

test("el acceso externo usa el encabezado propio aunque Azure reemplace Authorization, sin exigir cuenta interna", async () => {
  const fixture = endpoints(null);
  const token = createReviewToken();
  const response = await fixture.registered.get("partnerReview").handler({ headers: new Headers({ "X-VCM-Link-Token": token, Authorization: "Bearer azure-platform-token" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(fixture.calls[0].name, "getPartnerReview");
  assert.equal(fixture.calls[0].args[0], token);
});

test("un guardado inválido se rechaza antes de escribir y no admite valoración fraccionaria", async () => {
  const fixture = endpoints(null);
  const response = await fixture.registered.get("savePartnerEvaluation").handler({
    headers: new Headers({ Authorization: `Bearer ${createReviewToken()}` }), params: { teamId: "team" },
    json: async () => ({ strengths: "Texto", improvements: "Texto", rating: 4.5 }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.jsonBody.error.code, "INVALID_REVIEW_RATING");
  assert.equal(fixture.calls.length, 0);
});

test("la ruta de video envía el token y el equipo al repositorio sin aceptar rutas del cliente", async () => {
  const fixture = endpoints(null);
  const token = createReviewToken();
  const response = await fixture.registered.get("partnerReviewVideo").handler({
    headers: new Headers({ Authorization: `Bearer ${token}` }), params: { teamId: "allowed-team" },
    url: "https://example.test/api/partner-review/teams/allowed-team/video?sectionId=other&blob=secret.mp4",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(fixture.calls[0].name, "getPartnerReviewVideo");
  assert.equal(fixture.calls[0].args[0], token);
  assert.equal(fixture.calls[0].args[1], "allowed-team");
  assert.equal(fixture.calls[0].args.length, 2);
});
