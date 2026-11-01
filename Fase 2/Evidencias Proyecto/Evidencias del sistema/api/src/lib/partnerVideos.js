const { BlobServiceClient, BlobSASPermissions, SASProtocol } = require("@azure/storage-blob");
const { assertLocalVideo } = require("./localSafety");
const { getConfig } = require("./config");
const { AppError } = require("./http");

const VIDEO_SAS_TTL_MS = 5 * 60 * 1000;

function videoAccessExpiry(reviewExpiresAt, now = Date.now()) {
  const deadline = reviewExpiresAt ? Date.parse(reviewExpiresAt) : now + VIDEO_SAS_TTL_MS;
  if (!Number.isFinite(deadline) || deadline <= now) {
    throw new AppError(404, "REVIEW_UNAVAILABLE", "El enlace de revisión ya no está disponible.");
  }
  return new Date(Math.min(now + VIDEO_SAS_TTL_MS, deadline));
}

function createPrivateVideoStorage(config) {
  assertLocalVideo(config);
  const pipelineOptions = { retryOptions: { maxTries: 1 } };
  const service = BlobServiceClient.fromConnectionString(config.videoConnectionString, pipelineOptions);
  const container = service.getContainerClient(config.videoContainerName);
  return {
    // Las propiedades incluyen blobPublicAccess y sólo requieren Data Reader.
    getContainerProperties: (options) => container.getProperties(options),
    getBlobClient: (name) => container.getBlobClient(name),
    sign: async (client, sasOptions) => {
      return client.generateSasUrl(sasOptions);
    },
  };
}

async function resolvePartnerVideo(context, team, options = {}) {
  const { buildVideoBlobUrl, findTeamVideo, getVideoTeamNumber } = await import("../shared/partnerVideoPaths.mjs");
  const config = options.config || getConfig();
  const accountUrl = config.videoAccountUrl;
  const containerName = config.videoContainerName;
  try {
    const accessMode = config.videoAccessMode || "public";
    if (!["public", "private"].includes(accessMode)) {
      throw new AppError(503, "REVIEW_VIDEO_CONFIGURATION", "La coordinación debe revisar la configuración del almacenamiento de videos.");
    }
    const privateAccess = accessMode === "private";
    const expiresOn = videoAccessExpiry(options.reviewExpiresAt);
    if (team.videoDeliveryPending) return { status: "pending", url: null };
    const number = getVideoTeamNumber(team);
    if (!team.videoBlobName && number !== null && options.teams?.filter((item) => getVideoTeamNumber(item) === number).length > 1) {
      throw new AppError(409, "REVIEW_VIDEO_AMBIGUOUS_TEAM", "Hay equipos con el mismo número. Solicita a la coordinación que revise sus nombres.");
    }
    buildVideoBlobUrl("campus/asignatura/001D/Videoequipo1.mp4", accountUrl, containerName);
    const storage = options.storage || (privateAccess ? createPrivateVideoStorage(config)
      : new BlobServiceClient(accountUrl, { retryOptions: { maxTries: 1 } }).getContainerClient(containerName));
    if (privateAccess) {
      const policy = await storage.getContainerProperties({ abortSignal: AbortSignal.timeout(5000) });
      if (policy.blobPublicAccess) {
        throw new AppError(503, "REVIEW_VIDEO_CONTAINER_PUBLIC", "Los videos todavía no tienen habilitado el acceso privado. Contacta a la coordinación.");
      }
    }
    return await findTeamVideo(context, team, async (blobName) => {
      const client = storage.getBlobClient(blobName);
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 5000);
      let properties;
      try { properties = await client.getProperties({ abortSignal: abort.signal }); }
      catch (error) {
        const code = error.code || error.details?.errorCode || error.response?.headers?.get("x-ms-error-code");
        if (error.statusCode === 404 && code === "BlobNotFound") return null;
        throw error;
      } finally { clearTimeout(timeout); }
      if (properties.contentType?.split(";")[0].toLowerCase() !== "video/mp4" || properties.contentLength <= 0) {
        throw new AppError(422, "REVIEW_VIDEO_FORMAT", "El archivo del equipo debe ser un video MP4 válido. Solicita a la coordinación que revise su formato.");
      }
      // Se vuelve a comprobar el vencimiento después de consultar Azure.
      const currentExpiry = videoAccessExpiry(options.reviewExpiresAt);
      if (!privateAccess) return { url: buildVideoBlobUrl(blobName, accountUrl, containerName), expiresAt: null };
      const expiry = new Date(Math.min(currentExpiry.getTime(), expiresOn.getTime()));
      const url = await storage.sign(client, { permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.HttpsAndHttp, startsOn: new Date(Date.now() - 60 * 1000), expiresOn: expiry });
      return { url, expiresAt: expiry.toISOString() };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    // No registrar ni devolver errores del SDK que puedan incluir credenciales o URLs firmadas.
    throw new AppError(503, "REVIEW_VIDEO_UNAVAILABLE", "No fue posible consultar el video. Intenta nuevamente o contacta a la coordinación.");
  }
}

module.exports = { createPrivateVideoStorage, resolvePartnerVideo, videoAccessExpiry };
