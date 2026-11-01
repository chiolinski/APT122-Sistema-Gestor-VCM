const LOCAL_DATABASE = "vcm_piloto_2026_local";
const LOCAL_VIDEO_URL = "http://127.0.0.1:10000/devstoreaccount1";

function assertSqlTarget(config, { allowMaster = false } = {}) {
  const allowedDatabase = config.database === LOCAL_DATABASE || (allowMaster && config.database === "master");
  if (config.server !== "127.0.0.1" || config.port !== 14333 || !allowedDatabase || config.options?.instanceName
      || (config.authentication?.type && config.authentication.type !== "default") || config.options?.trustedConnection) {
    throw new Error("Aislamiento local: sólo se permite SQL en 127.0.0.1:14333 y la base de pruebas.");
  }
}
function assertLocalStorage(connectionString) {
  if (connectionString !== "UseDevelopmentStorage=true") {
    throw new Error("Aislamiento local: sólo se permite Azurite con UseDevelopmentStorage=true.");
  }
}
function assertLocalVideo(config) {
  if (config.videoAccountUrl !== LOCAL_VIDEO_URL || config.videoContainerName !== "vcm-local-videos"
      || config.videoManagedIdentityClientId || config.videoAccessMode !== "private") {
    throw new Error("Aislamiento local: la configuración de videos debe apuntar al contenedor privado de Azurite.");
  }
  assertLocalStorage(config.videoConnectionString);
}
module.exports = { LOCAL_DATABASE, LOCAL_VIDEO_URL, assertSqlTarget, assertLocalStorage, assertLocalVideo };
