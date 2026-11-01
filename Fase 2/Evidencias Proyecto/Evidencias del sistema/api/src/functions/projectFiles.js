const { app } = require("@azure/functions");
const { requireUser } = require("../lib/auth");
const { AppError, handleError, ok } = require("../lib/http");
const { getConfig } = require("../lib/config");
const { sanitizeFilename } = require("../lib/projectFiles");
const { deleteProjectFile, getProjectFile, uploadProjectFile } = require("../repositories/projectFileRepository");

function readFilename(request) {
  const encoded = request.headers.get("x-file-name") || "";
  try { return sanitizeFilename(decodeURIComponent(encoded)); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_FILE_NAME", "El nombre del archivo no es válido.");
  }
}

app.http("uploadProjectFile", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/files",
  handler: async (request, context) => {
    try {
      const principal = await requireUser(request);
      const length = Number(request.headers.get("content-length") || 0);
      if (length > getConfig().projectFileMaxBytes) throw new AppError(413, "FILE_TOO_LARGE", "El archivo supera el tamaño máximo permitido.");
      const url = new URL(request.url);
      const body = Buffer.from(await request.arrayBuffer());
      return ok(await uploadProjectFile(request.params.id, {
        category: url.searchParams.get("category"),
        sectionId: url.searchParams.get("sectionId"),
        replaceFileId: url.searchParams.get("replaceFileId"),
        name: readFilename(request),
        contentType: request.headers.get("content-type"),
      }, body, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("downloadProjectFile", {
  methods: ["GET"], authLevel: "anonymous", route: "projects/{id}/files/{fileId}",
  handler: async (request, context) => {
    try {
      const file = await getProjectFile(request.params.id, request.params.fileId, await requireUser(request));
      const asciiName = file.name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
      return {
        status: 200,
        body: file.body,
        headers: {
          "Content-Type": file.contentType || "application/octet-stream",
          "Content-Length": String(file.body.length),
          "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      };
    } catch (error) { return handleError(error, context); }
  },
});

app.http("deleteProjectFile", {
  methods: ["DELETE"], authLevel: "anonymous", route: "projects/{id}/files/{fileId}",
  handler: async (request, context) => {
    try {
      return ok(await deleteProjectFile(request.params.id, request.params.fileId, await requireUser(request)));
    } catch (error) { return handleError(error, context); }
  },
});

module.exports = { readFilename };
