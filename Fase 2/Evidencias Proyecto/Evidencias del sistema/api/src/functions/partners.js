const { app } = require("@azure/functions");
const { requireRole } = require("../lib/auth");
const { created, handleError, ok, readJson } = require("../lib/http");
const { validatePartnerInput } = require("../lib/operationalData");
const { validatePartnerRows } = require("../lib/partnerRows");
const { createPartner, listPartners, updatePartner } = require("../repositories/partnerRepository");
const { applyPartnerImport, listPartnerImports, previewPartnerImport } = require("../repositories/partnerImportRepository");

app.http("listPartners", {
  methods: ["GET"], authLevel: "anonymous", route: "partners",
  handler: async (request, context) => {
    try {
      await requireRole(request, ["admin", "coordinator", "teacher"]);
      return ok(await listPartners());
    } catch (error) { return handleError(error, context); }
  },
});

app.http("createPartner", {
  methods: ["POST"], authLevel: "anonymous", route: "partners",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      return created(await createPartner(validatePartnerInput(await readJson(request)), principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("updatePartner", {
  methods: ["PATCH"], authLevel: "anonymous", route: "partners/{id}",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin"]);
      return ok(await updatePartner(request.params.id, validatePartnerInput(await readJson(request)), principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("previewPartnerImport", {
  methods: ["POST"], authLevel: "anonymous", route: "partners/imports/preview",
  handler: async (request, context) => {
    try {
      await requireRole(request, ["admin", "coordinator"]);
      const body = await readJson(request);
      return ok(await previewPartnerImport(validatePartnerRows(body.rows)));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("applyPartnerImport", {
  methods: ["POST"], authLevel: "anonymous", route: "partners/imports/apply",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      const body = await readJson(request);
      return ok(await applyPartnerImport(validatePartnerRows(body.rows), body.filename, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("listPartnerImports", {
  methods: ["GET"], authLevel: "anonymous", route: "partners/imports",
  handler: async (request, context) => {
    try {
      await requireRole(request, ["admin", "coordinator"]);
      return ok(await listPartnerImports());
    } catch (error) { return handleError(error, context); }
  },
});
