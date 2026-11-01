const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrivateVideoStorage, resolvePartnerVideo, videoAccessExpiry } = require("../src/lib/partnerVideos");
const { BlobClient, BlobServiceClient, ContainerClient } = require("@azure/storage-blob");

const context = { campusName: "Concepción", subjectName: "Desarrollo de aplicaciones móviles", sectionCode: "001D" };
const config = { videoAccountUrl: "http://127.0.0.1:10000/devstoreaccount1", videoContainerName: "vcm-local-videos", videoAccessMode: "private", videoConnectionString: "UseDevelopmentStorage=true" };
const missing = () => Object.assign(new Error("missing"), { statusCode: 404, code: "BlobNotFound" });
const pathModule = import("../src/shared/partnerVideoPaths.mjs");

function storageFor(getBlobClient, policy = {}) {
  return {
    getContainerProperties: async () => policy,
    getBlobClient: (name) => ({ ...getBlobClient(name), name }),
    sign: async (client, options) => client.generateSasUrl ? client.generateSasUrl(options)
      : `http://127.0.0.1:10000/devstoreaccount1/vcm-local-videos/${client.name.split("/").map(encodeURIComponent).join("/")}?sig=test`,
  };
}

test("normaliza tildes, asignaturas con de y códigos de sección, conservando nombres de sedes", async () => {
  const { getSectionVideoFolder } = await pathModule;
  assert.equal(getSectionVideoFolder(context), "concepcion/desarrollo-aplicaciones-moviles/001D");
  assert.equal(getSectionVideoFolder({ ...context, campusName: "Sede Viña del Mar", sectionCode: " 002d " }), "vina-del-mar/desarrollo-aplicaciones-moviles/002D");
  for (const sectionCode of ["../001D", "001D/002D", "001D%2f002D", "", "001D#otra"]) {
    assert.equal(getSectionVideoFolder({ ...context, sectionCode }), null);
  }
  assert.equal(getSectionVideoFolder({ ...context, subjectName: "" }), null);
});

test("asocia el número del nombre sin depender de la posición del equipo", async () => {
  const { getVideoTeamNumber, getVideoCandidates } = await pathModule;
  for (const [name, number] of [["Equipo 10", 10], ["Equipo 2", 2], ["equipo 01", 1], ["Grupo 20", 20]]) {
    assert.equal(getVideoTeamNumber({ name }), number);
    assert.match(getVideoCandidates(context, { name })[0], new RegExp(`Videoequipo${number}\\.mp4$`));
  }
  for (const name of ["Equipo 0", "Equipo 21", "Equipo -1", "Equipo 1/otro", "Propuesta libre", "Equipo 1.5"]) {
    assert.deepEqual(getVideoCandidates(context, { name }), []);
  }
});

test("los videos de prueba sólo son excepciones de sus equipos en la sección acordada", async () => {
  const { getVideoCandidates } = await pathModule;
  assert.equal(getVideoCandidates(context, { name: "Equipo 1" })[1], "concepcion/desarrollo-aplicaciones-moviles/001D/EjemploEquipo1.mp4");
  assert.equal(getVideoCandidates(context, { name: "Equipo 1" })[2], "concepcion/desarrollo-aplicaciones-moviles/001D/Video VcM.mp4");
  for (const scope of [{ ...context, campusName: "Maipú" }, { ...context, sectionCode: "002D" }, { ...context, subjectName: "Otra asignatura" }]) {
    for (const number of [1, 2, 3]) assert.equal(getVideoCandidates(scope, { name: `Equipo ${number}` }).length, 1);
  }
  assert.match(getVideoCandidates(context, { name: "Equipo 2" })[1], /OtroEjemploEquipo2\.mp4$/);
  assert.match(getVideoCandidates(context, { name: "Equipo 3" })[1], /EjemploEquipo3\.mp4$/);
  assert.equal(getVideoCandidates(context, { name: "Equipo 4" }).length, 1);
});

test("el video confirmado por alumnos queda fijado por equipo y sección, sin volver al archivo numerado", async () => {
  const { getVideoCandidates } = await pathModule;
  const id = "6f9619ff-8b86-d011-b42d-000000000003";
  const team = { id, name: "Equipo 1", videoBlobName: `concepcion/desarrollo-aplicaciones-moviles/001D/Entrega-${id}-6f9619ff-8b86-d011-b42d-000000000004.mp4` };
  assert.deepEqual(getVideoCandidates(context, team), [team.videoBlobName]);
  assert.throws(() => getVideoCandidates({ ...context, sectionCode: "002D" }, team));
  assert.throws(() => getVideoCandidates(context, { ...team, id: "otro-equipo" }));
});

test("una entrega de alumnos pendiente no se sustituye por un video antiguo del mismo equipo", async () => {
  const result = await resolvePartnerVideo(context, { name: "Equipo 1", videoDeliveryPending: true }, { config,
    storage: { getContainerProperties: () => { throw new Error("must not read legacy files"); } } });
  assert.deepEqual(result, { status: "pending", url: null });
});

test("codifica el espacio del video de prueba y rechaza destinos ajenos a Azure o rutas inválidas", async () => {
  const { buildVideoBlobUrl } = await pathModule;
  const path = "concepcion/desarrollo-aplicaciones-moviles/001D/Video VcM.mp4";
  assert.match(buildVideoBlobUrl(path), /Video%20VcM\.mp4$/);
  for (const account of ["http://cloudblocked.blob.core.windows.net", "https://example.test", "https://test.blob.core.windows.net@evil.test", "https://test.blob.core.windows.net/?sig=secret"]) {
    assert.throws(() => buildVideoBlobUrl(path, account));
  }
  assert.throws(() => buildVideoBlobUrl("../asignatura/001D/Videoequipo1.mp4"));
  assert.throws(() => buildVideoBlobUrl(path, config.videoAccountUrl, "../otro"));
});

test("usa Video VcM.mp4 cuando no existe el archivo numerado, y prefiere el numerado al incorporarlo", async () => {
  const queried = [];
  const getBlobClient = (name) => ({ getProperties: async () => { queried.push(name); if (!name.endsWith("Video VcM.mp4")) throw missing(); return { contentType: "video/mp4", contentLength: 12500000 }; } });
  const result = await resolvePartnerVideo(context, { name: "Equipo 1" }, { config, storage: storageFor(getBlobClient) });
  assert.equal(queried.length, 3);
  assert.equal(result.status, "available");
  assert.equal(result.filename, "Video VcM.mp4");
  assert.match(result.url, /Video%20VcM\.mp4\?sig=/);
  const numbered = await resolvePartnerVideo(context, { name: "Equipo 1" }, { config,
    storage: storageFor(() => ({ getProperties: async () => ({ contentType: "video/mp4", contentLength: 100 }) })) });
  assert.equal(numbered.filename, "Videoequipo1.mp4");
});

test("reconoce el error de HEAD que devuelve Azure sin entregar acceso anónimo", async () => {
  const calls = [];
  const storage = storageFor((name) => ({
    getProperties: async () => {
      calls.push(name);
      if (!name.endsWith("Video VcM.mp4")) throw Object.assign(new Error("not found"), { statusCode: 404, details: { errorCode: "BlobNotFound" } });
      return { contentType: "video/mp4", contentLength: 12500872 };
    },
  }));
  const result = await resolvePartnerVideo(context, { name: "Equipo 1" }, { config, storage });
  assert.equal(calls.length, 3);
  assert.equal(result.filename, "Video VcM.mp4");
});

test("los tres archivos indicados por el usuario se asocian a su equipo sin reutilizar otro video", async () => {
  const filenames = ["EjemploEquipo1.mp4", "OtroEjemploEquipo2.mp4", "EjemploEquipo3.mp4"];
  for (const [index, filename] of filenames.entries()) {
    const result = await resolvePartnerVideo(context, { name: `Equipo ${index + 1}` }, { config,
      storage: storageFor((name) => ({ getProperties: async () => {
        if (!name.endsWith(`/${filename}`)) throw missing();
        return { contentType: "video/mp4", contentLength: 330000 };
      } })) });
    assert.equal(result.filename, filename);
  }
});

test("un video ausente queda pendiente, pero un error de permiso o de contenedor se informa como error", async () => {
  const absent = await resolvePartnerVideo(context, { name: "Equipo 2" }, { config,
    storage: storageFor(() => ({ getProperties: async () => { throw missing(); } })) });
  assert.deepEqual(absent, { status: "pending", url: null });
  for (const error of [Object.assign(new Error("secret"), { statusCode: 403 }), Object.assign(new Error("secret"), { statusCode: 404, code: "ContainerNotFound" }), new Error("sig=secret")]) {
    let calls = 0;
    await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, { config,
      storage: storageFor(() => ({ getProperties: async () => { calls += 1; throw error; } })) }), (failure) => failure.code === "REVIEW_VIDEO_UNAVAILABLE" && !failure.message.includes("secret"));
    assert.equal(calls, 1);
  }
});

test("rechaza archivos vacíos o con tipo incorrecto y equipos con número ambiguo", async () => {
  for (const properties of [{ contentType: "application/octet-stream", contentLength: 100 }, { contentType: "video/mp4", contentLength: 0 }]) {
    await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 2" }, { config,
      storage: storageFor(() => ({ getProperties: async () => properties })) }), { code: "REVIEW_VIDEO_FORMAT" });
  }
  await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, { config, teams: [{ name: "Equipo 1" }, { name: "Grupo 1" }] }), { code: "REVIEW_VIDEO_AMBIGUOUS_TEAM" });
});

test("genera sólo lectura HTTPS durante cinco minutos y respeta el vencimiento del enlace", async () => {
  let permissions;
  const before = Date.now();
  const signed = await resolvePartnerVideo(context, { name: "Equipo 2" }, { config: { ...config, videoConnectionString: "configured" },
    storage: storageFor(() => ({ getProperties: async () => ({ contentType: "video/mp4", contentLength: 100 }), generateSasUrl: async (options) => {
      permissions = options;
      return "https://test.blob.core.windows.net/videos/team.mp4?sig=example";
    } })) });
  assert.equal(permissions.permissions.toString(), "r");
  assert.equal(permissions.protocol, "https,http");
  assert.ok(permissions.expiresOn.getTime() >= before + 5 * 60 * 1000);
  assert.ok(permissions.expiresOn.getTime() <= Date.now() + 5 * 60 * 1000);
  assert.equal(signed.expiresAt, permissions.expiresOn.toISOString());
  const now = Date.now();
  const closeDeadline = new Date(now + 60_000).toISOString();
  assert.equal(videoAccessExpiry(closeDeadline, now).toISOString(), closeDeadline);
  for (const deadline of ["invalid", new Date(now - 1000).toISOString()]) {
    assert.throws(() => videoAccessExpiry(deadline, now), { code: "REVIEW_UNAVAILABLE" });
  }
});

test("un contenedor público o credenciales ausentes se rechazan antes de buscar archivos o firmar", async () => {
  let reads = 0;
  const storage = storageFor(() => { reads += 1; throw new Error("must not read"); }, { blobPublicAccess: "blob" });
  await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, { config, storage }), { code: "REVIEW_VIDEO_CONTAINER_PUBLIC" });
  storage.getContainerProperties = async () => { throw new Error("client_secret=must-not-leak"); };
  await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, { config, storage }), (failure) => failure.code === "REVIEW_VIDEO_UNAVAILABLE" && !failure.message.includes("must-not-leak"));
  assert.equal(reads, 0);
});

test("un enlace vencido no realiza consultas de almacenamiento", async () => {
  let calls = 0;
  const storage = { getContainerProperties: async () => { calls += 1; return {}; } };
  await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, { config, storage, reviewExpiresAt: "2000-01-01T00:00:00Z" }), { code: "REVIEW_UNAVAILABLE" });
  assert.equal(calls, 0);
});

test("Azurite firma con clave local y nunca solicita una identidad Azure", async (t) => {
  t.mock.method(BlobServiceClient.prototype, "getUserDelegationKey", async () => { throw new Error("No debe solicitar identidad cloud"); });
  const storage = createPrivateVideoStorage(config);
  const result = await storage.sign({ generateSasUrl: async (options) => {
    assert.equal(options.permissions, "read-test");
    return "http://127.0.0.1:10000/devstoreaccount1/vcm-local-videos/video.mp4?sig=test";
  } }, { permissions: "read-test", startsOn: new Date(), expiresOn: new Date(Date.now() + 60_000) });
  assert.match(result, /\?sig=test$/);
});

test("el SDK firma un único archivo; otra sección recibe una firma diferente sin permisos de lista o escritura", async (t) => {
  t.mock.method(ContainerClient.prototype, "getProperties", async () => ({}));
  t.mock.method(BlobClient.prototype, "getProperties", async () => ({ contentType: "video/mp4", contentLength: 100 }));
  const privateConfig = { ...config, videoConnectionString: "UseDevelopmentStorage=true" };
  const a = new URL((await resolvePartnerVideo(context, { name: "Equipo 2" }, { config: privateConfig })).url);
  const b = new URL((await resolvePartnerVideo({ ...context, sectionCode: "002D" }, { name: "Equipo 2" }, { config: privateConfig })).url);
  assert.match(a.pathname, /\/001D\/Videoequipo2\.mp4$/);
  assert.match(b.pathname, /\/002D\/Videoequipo2\.mp4$/);
  assert.equal(a.searchParams.get("sr"), "b");
  assert.equal(a.searchParams.get("sp"), "r");
  assert.equal(a.searchParams.get("spr"), "https,http");
  assert.notEqual(a.searchParams.get("sig"), b.searchParams.get("sig"));
});

test("el modo público predeterminado consulta Azure sin credenciales y respeta la sección y el equipo", async (t) => {
  const calls = [];
  t.mock.method(ContainerClient.prototype, "getProperties", async () => { throw new Error("must not inspect private policy"); });
  t.mock.method(BlobServiceClient.prototype, "getUserDelegationKey", async () => { throw new Error("must not request credentials"); });
  t.mock.method(BlobClient.prototype, "getProperties", async function () {
    calls.push(this.url);
    if (this.url.endsWith("Videoequipo1.mp4")) throw missing();
    return { contentType: "video/mp4", contentLength: 12500872 };
  });
  const publicConfig = { ...config, videoAccessMode: undefined };
  const result = await resolvePartnerVideo(context, { name: "Equipo 1" }, { config: publicConfig });
  assert.equal(result.filename, "EjemploEquipo1.mp4");
  assert.equal(new URL(result.url).search, "");
  assert.equal(result.expiresAt, null);
  assert.equal(calls.length, 2);
  const other = await resolvePartnerVideo({ ...context, sectionCode: "002D" }, { name: "Equipo 2" }, { config: publicConfig });
  assert.match(other.url, /\/002D\/Videoequipo2\.mp4$/);
});

test("el modo público conserva el rechazo de enlaces vencidos y no oculta fallos de permisos", async () => {
  let reads = 0;
  const options = { config: { ...config, videoAccessMode: "public" }, storage: storageFor(() => ({ getProperties: async () => {
    reads += 1;
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  } })) };
  await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, { ...options, reviewExpiresAt: "2000-01-01T00:00:00Z" }), { code: "REVIEW_UNAVAILABLE" });
  assert.equal(reads, 0);
  await assert.rejects(resolvePartnerVideo(context, { name: "Equipo 1" }, options), { code: "REVIEW_VIDEO_UNAVAILABLE" });
  assert.equal(reads, 1);
});
