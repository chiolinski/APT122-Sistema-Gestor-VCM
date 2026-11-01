const { app } = require("@azure/functions");
const { requireAdmin } = require("../lib/auth");
const { handleError, ok } = require("../lib/http");
const { getPilotOverview, getPilotReport, listAuditEvents } = require("../repositories/pilotReportRepository");

app.http("pilotOverview", {
  methods: ["GET"], authLevel: "anonymous", route: "pilot-reports/overview",
  handler: async (request, context) => {
    try { await requireAdmin(request); return ok(await getPilotOverview()); }
    catch (error) { return handleError(error, context); }
  },
});

app.http("pilotReport", {
  methods: ["GET"], authLevel: "anonymous", route: "pilot-reports/{dimension}",
  handler: async (request, context) => {
    try { await requireAdmin(request); return ok(await getPilotReport(request.params.dimension)); }
    catch (error) { return handleError(error, context); }
  },
});

app.http("auditEvents", {
  methods: ["GET"], authLevel: "anonymous", route: "audit-events",
  handler: async (request, context) => {
    try {
      await requireAdmin(request);
      const url = new URL(request.url);
      return ok(await listAuditEvents(url.searchParams.get("query"), url.searchParams.get("page"), url.searchParams.get("pageSize")));
    } catch (error) { return handleError(error, context); }
  },
});
