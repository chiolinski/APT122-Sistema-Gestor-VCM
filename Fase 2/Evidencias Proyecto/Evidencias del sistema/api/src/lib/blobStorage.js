const { BlobServiceClient } = require("@azure/storage-blob");
const { getConfig } = require("./config");
const { AppError } = require("./http");

let containerPromise;

async function getContainer() {
  if (!containerPromise) {
    const { blobConnectionString, blobContainerName } = getConfig();
    if (!blobConnectionString) {
      throw new AppError(503, "BLOB_STORAGE_NOT_CONFIGURED", "El almacenamiento de archivos todavía no está configurado en Azure.");
    }
    const container = BlobServiceClient.fromConnectionString(blobConnectionString).getContainerClient(blobContainerName);
    containerPromise = container.createIfNotExists().then(() => container).catch((error) => {
      containerPromise = undefined;
      throw error;
    });
  }
  return containerPromise;
}

async function uploadBlob(storageKey, body, contentType) {
  const container = await getContainer();
  const client = container.getBlockBlobClient(storageKey);
  await client.uploadData(body, {
    blobHTTPHeaders: { blobContentType: contentType },
    metadata: { source: "vcm-piloto-2026" },
  });
}

async function downloadBlob(storageKey, maxBytes) {
  const container = await getContainer();
  const client = container.getBlockBlobClient(storageKey);
  const properties = await client.getProperties();
  if (properties.contentLength > maxBytes) throw new Error("El archivo almacenado supera el límite de descarga configurado.");
  return client.downloadToBuffer();
}

async function deleteBlobIfExists(storageKey) {
  if (!storageKey) return;
  const container = await getContainer();
  await container.getBlockBlobClient(storageKey).deleteIfExists({ deleteSnapshots: "include" });
}

module.exports = { deleteBlobIfExists, downloadBlob, uploadBlob };
