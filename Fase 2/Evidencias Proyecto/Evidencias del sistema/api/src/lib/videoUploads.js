const { BlobSASPermissions, SASProtocol } = require("@azure/storage-blob");
const { createPrivateVideoStorage } = require("./partnerVideos");
const { getConfig } = require("./config");
const { AppError } = require("./http");

const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
async function buildDeliveryBlobName(context, teamId, attemptId) {
  const { getSectionVideoFolder } = await import("../shared/partnerVideoPaths.mjs");
  const folder = getSectionVideoFolder(context);
  if (!folder) throw new AppError(409, "VIDEO_UPLOAD_FOLDER", "Coordinación debe revisar los datos de la sección.");
  return `${folder}/Entrega-${teamId}-${attemptId}.mp4`;
}
function validateVideoUpload(input = {}) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 260 || !/\.mp4$/i.test(name) || /[\\/]/.test(name) || [...name].some((character) => character.charCodeAt(0) < 32)) {
    throw new AppError(400, "INVALID_VIDEO_NAME", "Selecciona un archivo MP4 con un nombre válido.");
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > VIDEO_MAX_BYTES) {
    throw new AppError(400, "INVALID_VIDEO_SIZE", "El video debe pesar entre 1 byte y 200 MB.");
  }
  return { name, size: input.size };
}

async function uploadStorage(blobName, options = {}) {
  const config = options.config || getConfig();
  if (!config.videoUploadEnabled) throw new AppError(503, "VIDEO_UPLOAD_NOT_CONFIGURED", "La carga de videos aún no está habilitada. Contacta a coordinación.");
  const { buildVideoBlobUrl } = await import("../shared/partnerVideoPaths.mjs");
  buildVideoBlobUrl(blobName, config.videoAccountUrl, config.videoContainerName);
  const storage = options.storage || createPrivateVideoStorage(config);
  return { storage, client: storage.getBlobClient(blobName) };
}

async function signVideoUpload(blobName, expiresAt, options = {}) {
  try {
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new AppError(409, "VIDEO_UPLOAD_EXPIRED", "El intento de carga venció. Inicia uno nuevo.");
    const { storage, client } = await uploadStorage(blobName, options);
    const expiresOn = new Date(Math.min(deadline, Date.now() + 15 * 60_000));
    // Create only: cannot overwrite an existing blob, read, list or delete files.
    const url = await storage.sign(client, { permissions: BlobSASPermissions.parse("c"), protocol: SASProtocol.HttpsAndHttp,
      startsOn: new Date(Date.now() - 60_000), expiresOn });
    return { url, expiresAt: expiresOn.toISOString() };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "VIDEO_UPLOAD_UNAVAILABLE", "No fue posible preparar la carga. Coordinación debe revisar las credenciales y permisos de videos.");
  }
}

async function verifyVideoUpload(blobName, expectedSize, options = {}) {
  try {
    const { client } = await uploadStorage(blobName, options);
    const abortSignal = AbortSignal.timeout(10_000);
    const properties = await client.getProperties({ abortSignal });
    if (properties.contentLength !== expectedSize || properties.contentLength > VIDEO_MAX_BYTES
      || properties.contentType?.split(";")[0].toLowerCase() !== "video/mp4") {
      throw new AppError(422, "VIDEO_UPLOAD_INVALID", "El video recibido no coincide con el archivo esperado o supera el límite permitido.");
    }
    const header = await client.downloadToBuffer(0, Math.min(12, expectedSize), { abortSignal });
    if (header.length < 12 || header.subarray(4, 8).toString("ascii") !== "ftyp") {
      throw new AppError(422, "VIDEO_UPLOAD_INVALID", "El archivo recibido no tiene una cabecera MP4 válida.");
    }
    return properties;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "VIDEO_UPLOAD_UNVERIFIED", "No fue posible confirmar el video. Puedes reintentar la confirmación sin volver a subirlo.");
  }
}

module.exports = { VIDEO_MAX_BYTES, buildDeliveryBlobName, validateVideoUpload, signVideoUpload, verifyVideoUpload };
