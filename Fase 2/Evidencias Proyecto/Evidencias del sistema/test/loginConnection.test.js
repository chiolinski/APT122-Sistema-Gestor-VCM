import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { login } from "../src/services/authApi.js";

const healthy = () => Response.json({ status: "ok", service: "vcm-piloto-2026-api" });
const signedIn = () => Response.json({ data: { id: "user-1", name: "Docente" } });
const flush = () => setImmediate();

test("espera a SQL antes de enviar las credenciales y avisa al continuar", async (t) => {
  let resolveHealth;
  let authenticating = false;
  const health = new Promise((resolve) => { resolveHealth = resolve; });
  const fetch = t.mock.method(globalThis, "fetch", async (path, options) => {
    if (path === "/api/health") {
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
      assert.equal(options.body, undefined);
      return health;
    }
    assert.equal(authenticating, true);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { email: "docente@example.com", password: "example-password" });
    return signedIn();
  });

  const result = login("docente@example.com", "example-password", {
    onAuthenticating: () => { authenticating = true; },
  });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(authenticating, false);
  resolveHealth(healthy());
  assert.deepEqual(await result, { id: "user-1", name: "Docente" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("reintenta salud tras errores temporales de Azure y de red", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const responses = [
    () => new Response("Backend unavailable", { status: 504 }),
    () => Response.json({ status: "degraded" }, { status: 503 }),
    () => { throw new TypeError("Failed to fetch"); },
    healthy,
    signedIn,
  ];
  const fetch = t.mock.method(globalThis, "fetch", async () => responses.shift()());
  const result = login("docente@example.com", "example-password");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await flush();
    assert.equal(fetch.mock.callCount(), attempt + 1);
    assert.ok(fetch.mock.calls.every((call) => call.arguments[0] === "/api/health"));
    t.mock.timers.tick(3_000);
  }
  await result;
  assert.equal(fetch.mock.calls.filter((call) => call.arguments[0] === "/api/auth/login").length, 1);
});

test("una comprobación colgada se cancela y puede recuperarse sin reenviar el ingreso", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const fetch = t.mock.method(globalThis, "fetch", async (path, { signal }) => {
    if (path === "/api/auth/login") return signedIn();
    attempts += 1;
    if (attempts > 1) return healthy();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const result = login("docente@example.com", "example-password");
  t.mock.timers.tick(20_000);
  await flush();
  assert.equal(fetch.mock.calls[0].arguments[1].signal.aborted, true);
  t.mock.timers.tick(3_000);
  await result;
  assert.equal(attempts, 2);
  assert.equal(fetch.mock.callCount(), 3);
});

test("termina la espera a los dos minutos sin enviar credenciales", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", async (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const result = assert.rejects(login("docente@example.com", "example-password"), /No pudimos conectar con el sistema/);
  t.mock.timers.tick(120_000);
  await result;
  assert.ok(fetch.mock.calls.every((call) => call.arguments[0] === "/api/health"));
});

test("cancelar al salir de la pantalla interrumpe la espera entre intentos", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const result = assert.rejects(login("docente@example.com", "example-password", { signal: controller.signal }), { name: "AbortError" });
  await flush();
  controller.abort();
  await result;
  t.mock.timers.tick(120_000);
  assert.equal(fetch.mock.callCount(), 1);
});

test("no reintenta credenciales incorrectas ni duplica el POST de ingreso", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (path) => path === "/api/health" ? healthy() : Response.json({
    error: { code: "INVALID_CREDENTIALS", message: "El correo o la contraseña no son correctos." },
  }, { status: 401 }));
  await assert.rejects(login("docente@example.com", "incorrecta"), { status: 401, code: "INVALID_CREDENTIALS" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("no reintenta errores permanentes ni acepta una página HTML como sistema disponible", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  await assert.rejects(login("docente@example.com", "example-password"), /No pudimos conectar/);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => new Response("<!doctype html><title>Login</title>"));
  await assert.rejects(login("docente@example.com", "example-password"), /No pudimos conectar/);
  assert.equal(fetch.mock.callCount(), 2);
});
