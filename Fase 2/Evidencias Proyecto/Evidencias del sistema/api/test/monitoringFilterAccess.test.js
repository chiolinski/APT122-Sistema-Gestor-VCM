const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { AppError } = require("../src/lib/http");

test("la ruta de seguimiento autoriza antes de transmitir sus filtros al repositorio", async () => {
  const filename = path.resolve(__dirname, "../src/functions/projects.js");
  const nativeRequire = createRequire(filename);
  const registry = new Map();
  const calls = [];
  let principal = null;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { URL,
    require: (id) => {
      if (id === "@azure/functions") return { app: { http: (name, route) => registry.set(name, route) } };
      if (id === "../lib/auth") return { requireUser: async () => {
        if (!principal) throw new AppError(401, "AUTH_REQUIRED", "Inicia sesión.");
        return principal;
      } };
      if (id === "../repositories/projectRepository") return {};
      if (id === "../repositories/coordinationMonitoringRepository") return {
        listCoordinationMonitoring: async (filters) => { calls.push(JSON.parse(JSON.stringify(filters))); return { filters, projects: [] }; },
      };
      return nativeRequire(id);
    },
  }, { filename });
  const route = registry.get("coordinationProjectMonitoring");
  const request = { url: "http://127.0.0.1:7076/api/projects/monitoring?scope=finished&campus=Sede%20ficticia&search=proyecto&period=2026-2" };
  assert.equal((await route.handler(request, {})).status, 401);
  principal = { role: "teacher" };
  assert.equal((await route.handler(request, {})).status, 403);
  assert.equal(calls.length, 0);
  for (const role of ["admin", "coordinator"]) {
    principal = { role };
    const response = await route.handler(request, {});
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), { scope: "finished", campus: "Sede ficticia", search: "proyecto", period: "2026-2" });
  }
});

test("un estado desconocido se rechaza antes de conectar con SQL", async (t) => {
  const { sql } = require("../src/lib/db");
  const { listCoordinationMonitoring } = require("../src/repositories/coordinationMonitoringRepository");
  let connections = 0;
  t.mock.method(sql.ConnectionPool.prototype, "connect", () => { connections += 1; throw new Error("No debe conectar."); });
  await assert.rejects(listCoordinationMonitoring({ scope: "desconocido" }), { code: "INVALID_MONITORING_SCOPE", status: 400 });
  assert.equal(connections, 0);
});
