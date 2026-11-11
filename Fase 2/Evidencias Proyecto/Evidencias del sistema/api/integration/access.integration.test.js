const { test, before } = require("node:test");
const assert = require("node:assert/strict");

const API = "http://127.0.0.1:7076/api";
const PASSWORD = "LocalVCM2026!";

async function login(email) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(response.status, 200, `No se pudo iniciar sesión como ${email}`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

async function getIndicators(cookie, query = "") {
  const response = await fetch(`${API}/indicators${query}`, { headers: cookie ? { cookie } : {} });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  assert.ok(health?.ok, "La API no responde en el puerto 7076: ejecuta npm run local:api");
});

test("coordinación y administración pueden consultar los indicadores", async () => {
  for (const email of ["coordinacion@example.test", "admin@example.test"]) {
    const { status, body } = await getIndicators(await login(email));
    assert.equal(status, 200, email);
    assert.ok(Array.isArray(body.data.projects));
  }
});

test("un docente con sesión válida recibe 403", async () => {
  const { status, body } = await getIndicators(await login("docente1@example.test"));
  assert.equal(status, 403);
  assert.equal(body.error.code, "MONITORING_ACCESS_DENIED");
});

test("sin sesión la API responde 401", async () => {
  const { status, body } = await getIndicators(null);
  assert.equal(status, 401);
  assert.equal(body.error.code, "AUTH_REQUIRED");
});

test("un período con inyección SQL se rechaza con 400", async () => {
  const cookie = await login("coordinacion@example.test");
  const { status, body } = await getIndicators(cookie, `?period=${encodeURIComponent("2026-2'; DROP TABLE vcm.Proyecto;--")}`);
  assert.equal(status, 400);
  assert.equal(body.error.code, "INVALID_PERIOD");
});
