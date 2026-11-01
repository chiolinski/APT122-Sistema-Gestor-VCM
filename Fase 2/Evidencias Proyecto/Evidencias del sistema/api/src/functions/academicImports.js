const { app } = require("@azure/functions");
const { requireAdmin } = require("../lib/auth");
const { handleError, ok, readJson } = require("../lib/http");
const { validateAcademicRows } = require("../lib/academicRows");
const { applyAcademicImport, listAcademicImports } = require("../repositories/academicImportRepository");

app.http("previewAcademicImport", {
  methods: ["POST"], authLevel: "anonymous", route: "academic-imports/preview",
  handler: async (request, context) => {
    try {
      await requireAdmin(request);
      const body = await readJson(request);
      return ok(validateAcademicRows(body.rows));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("applyAcademicImport", {
  methods: ["POST"], authLevel: "anonymous", route: "academic-imports/apply",
  handler: async (request, context) => {
    try {
      const principal = await requireAdmin(request);
      const body = await readJson(request);
      const parsed = validateAcademicRows(body.rows);
      return ok(await applyAcademicImport(parsed, body.filename || "carga-academica.csv", principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("listAcademicImports", {
  methods: ["GET"], authLevel: "anonymous", route: "academic-imports",
  handler: async (request, context) => {
    try {
      await requireAdmin(request);
      return ok(await listAcademicImports());
    } catch (error) { return handleError(error, context); }
  },
});
