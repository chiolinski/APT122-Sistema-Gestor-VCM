const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const { AppError } = require("../src/lib/http");

test("todas las rutas internas rechazan a docentes, coordinadores y sesiones ausentes antes de consultar o modificar datos", async () => {
  const filename = path.resolve(__dirname, "../src/functions/academicManagement.js");
  const endpoints = [];
  let authorized = false;
  let called = 0;
  const nativeRequire = createRequire(filename);
  const repository = Object.fromEntries([
    "managementCatalogs", "searchManagementSections", "searchManagementPeople", "managementSectionDetail", "executeAcademicAdjustment", "registerManagementTeacher",
  ].map((name) => [name, async () => { called += 1; return {}; }]));
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (id) => {
      if (id === "@azure/functions") return { app: { http: (name, endpoint) => endpoints.push({ name, ...endpoint }) } };
      if (id === "../lib/auth") return { requireAdmin: async () => {
        if (!authorized) throw new AppError(403, "ROLE_REQUIRED", "Solo administración.");
        return { id: "admin", role: "admin" };
      } };
      if (id === "../repositories/academicManagementRepository") return repository;
      return nativeRequire(id);
    },
  }, { filename });
  assert.equal(endpoints.length, 8);
  for (const endpoint of endpoints) {
    const response = await endpoint.handler({ url: "https://example.test/api/academic-management", params: {}, json: async () => { throw new Error("No se debe leer un cuerpo sin autorización"); } }, {});
    assert.equal(response.status, 403, endpoint.name);
  }
  assert.equal(called, 0);
  authorized = true;
  assert.equal((await endpoints.find((endpoint) => endpoint.name === "academicManagementCatalogs").handler({}, {})).status, 200);
  assert.equal(called, 1);
});
