const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sql, getPool } = require("../src/lib/db");
const { LOCAL_DATABASE, LOCAL_VIDEO_URL, assertSqlTarget, assertLocalStorage, assertLocalVideo } = require("../src/lib/localSafety");
const { validateAcademicRows } = require("../src/lib/academicRows");
const { getConfig } = require("../src/lib/config");
const root = path.resolve(__dirname, "../..");
const localSql = { server: "127.0.0.1", port: 14333, database: LOCAL_DATABASE, options: {} };

test("SQL sólo permite el servidor, puerto y base locales; master requiere autorización del instalador", () => {
  assert.doesNotThrow(() => assertSqlTarget(localSql));
  for (const change of [{ server: "cloud.database.windows.net" }, { server: "localhost" }, { server: "127.0.0.2" },
    { port: 1433 }, { database: "production" }, { database: "master" }, { options: { instanceName: "OTHER" } },
    { authentication: { type: "azure-active-directory-default" } }, { options: { trustedConnection: true } }]) {
    assert.throws(() => assertSqlTarget({ ...localSql, ...change }), /Aislamiento local/);
  }
  assert.doesNotThrow(() => assertSqlTarget({ ...localSql, database: "master" }, { allowMaster: true }));
  assert.throws(() => assertSqlTarget({ ...localSql, server: "remote", database: "master" }, { allowMaster: true }));
});

test("getPool rechaza una cadena cloud ANTES de invocar connect", (t) => {
  let connected = false;
  t.mock.method(sql.ConnectionPool.prototype, "connect", () => { connected = true; throw new Error("No debe conectar"); });
  const previous = process.env.AZURE_SQL_CONNECTION_STRING;
  try {
    for (const value of [
      "Server=cloud.database.windows.net;Database=production;User Id=test;Password=OnlyForUnitTest123!;",
      "Server=127.0.0.1,14333;Database=production;User Id=test;Password=OnlyForUnitTest123!;",
      "Server=127.0.0.1,1433;Database=vcm_piloto_2026_local;User Id=test;Password=OnlyForUnitTest123!;",
    ]) {
      process.env.AZURE_SQL_CONNECTION_STRING = value;
      assert.throws(() => getPool(), /Aislamiento local/);
    }
    assert.equal(connected, false);
  } finally {
    if (previous === undefined) delete process.env.AZURE_SQL_CONNECTION_STRING;
    else process.env.AZURE_SQL_CONNECTION_STRING = previous;
  }
});

test("storage rechaza credenciales cloud, endpoints alternativos e identidades administradas", () => {
  assert.doesNotThrow(() => assertLocalStorage("UseDevelopmentStorage=true"));
  for (const value of ["", "DefaultEndpointsProtocol=https;AccountName=cloud;AccountKey=test;EndpointSuffix=core.windows.net",
    "UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://example.test", "UseDevelopmentStorage=true;BlobEndpoint=http://example.test"]) {
    assert.throws(() => assertLocalStorage(value));
  }
  const config = { videoAccountUrl: LOCAL_VIDEO_URL, videoContainerName: "vcm-local-videos", videoAccessMode: "private", videoConnectionString: "UseDevelopmentStorage=true" };
  assert.doesNotThrow(() => assertLocalVideo(config));
  for (const change of [{ videoAccountUrl: "https://cloud.blob.core.windows.net" }, { videoManagedIdentityClientId: "cloud-id" },
    { videoAccessMode: "public" }, { videoContainerName: "production" }]) assert.throws(() => assertLocalVideo({ ...config, ...change }));
});

test("config rechaza variables cloud heredadas y evita devolverlas al usuario", () => {
  for (const key of ["AZURE_STORAGE_CONNECTION_STRING", "AzureWebJobsStorage", "AZURE_STORAGE_VIDEO_CONNECTION_STRING", "AZURE_STORAGE_VIDEO_ACCOUNT_URL"]) {
    const previous = process.env[key];
    try {
      process.env[key] = "https://cloud.example.test/?secret=must-not-leak";
      assert.throws(() => getConfig(), (error) => /Aislamiento local/.test(error.message) && !error.message.includes("must-not-leak"));
    } finally {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
  }
});

test("videos sólo construyen URLs locales y rechazan cloud, credenciales, rutas y contenedores ajenos", async () => {
  const { buildVideoBlobUrl } = await import("../src/shared/partnerVideoPaths.mjs");
  const blob = "sede-ficticia/asignatura/001D/Videoequipo1.mp4";
  assert.equal(buildVideoBlobUrl(blob), `${LOCAL_VIDEO_URL}/vcm-local-videos/${blob}`);
  for (const account of ["https://cloud.blob.core.windows.net", "http://127.0.0.1:10000/other", "http://127.0.0.1:10000@cloud.example.test/devstoreaccount1",
    `${LOCAL_VIDEO_URL}?sig=cloud`, "http://localhost:10000/devstoreaccount1"]) assert.throws(() => buildVideoBlobUrl(blob, account));
  assert.throws(() => buildVideoBlobUrl(blob, LOCAL_VIDEO_URL, "production"));
  assert.throws(() => buildVideoBlobUrl("../asignatura/001D/video.mp4"));
});

test("la carga de origen es sintética, válida y contiene los dos docentes y doce alumnos", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(root, "fixtures/academic-local.json"), "utf8"));
  const parsed = validateAcademicRows(rows);
  assert.equal(parsed.canApply, true);
  assert.equal(parsed.summary.students, 12);
  assert.equal(parsed.summary.sections, 2);
  assert.equal(parsed.summary.teachers, 2);
  for (const row of rows) {
    assert.match(row.estudiante_nombre, /^Estudiante ficticio/);
    assert.match(row.estudiante_correo, /@example\.test$/);
    assert.match(row.docente_correo, /@example\.test$/);
  }
});

test("los scripts y Vite conservan targets locales y el bloqueo de conexiones del navegador", () => {
  const vite = fs.readFileSync(path.join(root, "vite.config.js"), "utf8");
  assert.match(vite, /target: "http:\/\/127\.0\.0\.1:7076"/);
  assert.match(vite, /"Content-Security-Policy"/);
  assert.match(vite, /connect-src 'self' http:\/\/127\.0\.0\.1:10000 ws:\/\/127\.0\.0\.1:5176;/);
  const context = fs.readFileSync(path.join(root, "src/context/AppContext.jsx"), "utf8");
  assert.match(context, /const DEMO_MODE = false;/);
});
