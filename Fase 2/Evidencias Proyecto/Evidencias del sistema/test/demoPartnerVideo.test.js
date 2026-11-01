import test from "node:test";
import assert from "node:assert/strict";
import { getDemoPartnerVideo } from "../src/services/demoPartnerVideo.js";

test("la demo recupera el video de prueba del Equipo 1 si aún no existe el numerado", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Range, "bytes=0-0");
    return url.endsWith("Videoequipo1.mp4") ? new Response(null, { status: 404 })
      : new Response("x", { status: 206, headers: { "content-type": "video/mp4", "content-length": "1" } });
  });
  const result = await getDemoPartnerVideo({ name: "Equipo 1" });
  assert.equal(result.status, "available");
  assert.equal(result.filename, "EjemploEquipo1.mp4");
  assert.match(result.url, /\/concepcion\/desarrollo-aplicaciones-moviles\/001D\/EjemploEquipo1\.mp4$/);
  assert.equal(result.expiresAt, null);
  assert.equal(calls.length, 2);
});

test("otros equipos quedan pendientes sin reutilizar el video del Equipo 1", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return new Response(null, { status: 404 }); });
  assert.deepEqual(await getDemoPartnerVideo({ name: "Equipo 2" }), { status: "pending", url: null });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /Videoequipo2\.mp4$/);
  assert.match(calls[1], /OtroEjemploEquipo2\.mp4$/);
});

test("los equipos 2 y 3 recuperan sus nuevos archivos sin usar el del Equipo 1", async (t) => {
  const expected = ["OtroEjemploEquipo2.mp4", "EjemploEquipo3.mp4"];
  for (const [index, filename] of expected.entries()) {
    t.mock.method(globalThis, "fetch", async (url) => url.endsWith(filename)
      ? new Response("x", { status: 206, headers: { "content-type": "video/mp4", "content-length": "1" } })
      : new Response(null, { status: 404 }));
    const result = await getDemoPartnerVideo({ name: `Equipo ${index + 2}` });
    assert.equal(result.filename, filename);
  }
});

test("la demo prefiere el archivo numerado e informa errores de acceso y formato", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("x", { status: 206, headers: { "content-type": "video/mp4", "content-length": "1" } }));
  assert.equal((await getDemoPartnerVideo({ name: "Equipo 1" })).filename, "Videoequipo1.mp4");
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(getDemoPartnerVideo({ name: "Equipo 1" }), /No fue posible consultar/);
  t.mock.method(globalThis, "fetch", async () => new Response("x", { headers: { "content-type": "text/html", "content-length": "1" } }));
  await assert.rejects(getDemoPartnerVideo({ name: "Equipo 1" }), /MP4 válido/);
});
