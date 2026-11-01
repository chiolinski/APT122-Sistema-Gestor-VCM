const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { AppError } = require("../src/lib/http");
function endpoints(principal) {
  const routes = new Map(); const calls = [];
  const functions = ["getHitoTwoState", "createPartnerReview", "closeSectionPartnerReview", "createVideoDeliveryLinks", "getVideoDelivery", "beginVideoUpload", "confirmVideoUpload"];
  const repository = Object.fromEntries(functions.map((name) => [name, async (...args) => { calls.push({ name, args }); return { saved: true }; }]));
  const filename = path.resolve(__dirname, "../src/functions/hitoTwo.js");
  const nativeRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { require: (name) => {
    if (name === "@azure/functions") return { app: { http: (key, value) => routes.set(key, value) } };
    if (name.includes("/repositories/")) return repository;
    if (name === "../lib/auth") return {
      requireRole: async (_request, roles) => {
        if (!principal) throw new AppError(401, "AUTH_REQUIRED", "Sesión requerida");
        if (!roles.includes(principal.role)) throw new AppError(403, "ROLE_REQUIRED", "Rol no autorizado");
        return principal;
      },
      requireTeachingCapability: async () => {
        if (!principal) throw new AppError(401, "AUTH_REQUIRED", "Sesión requerida");
        if (!["teacher", "coordinator"].includes(principal.role) || !principal.canTeach) throw new AppError(403, "TEACHING_ASSIGNMENT_REQUIRED", "Docencia requerida");
        return principal;
      },
    };
    return nativeRequire(name);
  } });
  return { routes, calls };
}

test("las rutas docentes requieren sesión y capacidad de docencia antes de leer o crear enlaces", async () => {
  for (const principal of [null, { role: "admin" }, { role: "coordinator", canTeach: false }, { role: "teacher", canTeach: false }]) {
    const f = endpoints(principal);
    for (const name of ["sectionHitoTwo", "sectionVideoDeliveryLinks"]) {
      const response = await f.routes.get(name).handler({ method: "POST", params: { id: "project", sectionId: "section" } });
      assert.equal(response.status, principal ? 403 : 401);
    }
    assert.equal(f.calls.length, 0);
  }
  const f = endpoints({ role: "teacher", canTeach: true });
  const response = await f.routes.get("sectionHitoTwo").handler({ method: "GET", params: { id: "project", sectionId: "own-section" } });
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].args[1], "own-section"); // repository checks actual section assignment
});

test("los alumnos no necesitan cuentas: cada operación envía su token y nunca un destino del cliente", async () => {
  const f = endpoints(null);
  const token = "A".repeat(43);
  for (const [name, body] of [["studentVideoDelivery", null], ["beginStudentVideoUpload", { name: "video.mp4", size: 12 }],
    ["confirmStudentVideoUpload", { attemptId: "attempt", blob: "other-section" }]]) {
    const response = await f.routes.get(name).handler({ headers: new Headers({ "X-VCM-Link-Token": token, Authorization: "Bearer azure-platform-token" }), json: async () => body });
    assert.equal(response.status, 200); assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(f.calls.at(-1).args[0], token);
  }
  assert.equal(f.calls.at(-1).args.length, 2);
  assert.equal(f.calls.at(-1).args[1], "attempt");
});

test("el cierre interno exige sesión de docente/coordinador y fija proyecto y sección desde la ruta", async () => {
  for (const principal of [null, { role: "admin" }, { role: "student" }]) {
    const f = endpoints(principal);
    const response = await f.routes.get("closeSectionPartnerReview").handler({ method: "POST",
      params: { id: "project", sectionId: "section" }, json: async () => ({ reviewId: "review" }) });
    assert.equal(response.status, principal ? 403 : 401);
    assert.equal(f.calls.length, 0);
  }
  for (const role of ["teacher", "coordinator"]) {
    const f = endpoints({ role });
    const response = await f.routes.get("closeSectionPartnerReview").handler({ method: "POST",
      params: { id: "project", sectionId: "own-section" },
      json: async () => ({ reviewId: "review", sectionId: "other-section", completedAt: "fake", rating: 0 }) });
    assert.equal(response.status, 200);
    assert.equal(f.calls[0].name, "closeSectionPartnerReview");
    assert.deepEqual(f.calls[0].args.slice(0, 3), ["project", "own-section", "review"]);
  }
});
