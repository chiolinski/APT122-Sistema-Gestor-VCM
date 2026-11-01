const { app } = require("@azure/functions");
const { requireAdmin } = require("../lib/auth");
const { handleError, ok, readJson } = require("../lib/http");
const { validateAcademicRecordUpdate } = require("../lib/academicRecords");
const { listAcademicRecords, updateAcademicRecord } = require("../repositories/academicRecordsRepository");

app.http("listAcademicRecords", {
  methods: ["GET"], authLevel: "anonymous", route: "academic-records/{entity}",
  handler: async (request, context) => {
    try {
      await requireAdmin(request);
      const url = new URL(request.url);
      return ok(await listAcademicRecords(
        request.params.entity,
        url.searchParams.get("query") || "",
        url.searchParams.get("page") || 1,
        url.searchParams.get("pageSize") || 25,
      ));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("updateAcademicRecord", {
  methods: ["PATCH"], authLevel: "anonymous", route: "academic-records/{entity}/{id}",
  handler: async (request, context) => {
    try {
      const principal = await requireAdmin(request);
      const input = validateAcademicRecordUpdate(request.params.entity, await readJson(request));
      return ok(await updateAcademicRecord(request.params.entity, request.params.id, input, principal));
    } catch (error) { return handleError(error, context); }
  },
});
