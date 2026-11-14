const { app } = require("@azure/functions");
const { requireUser } = require("../lib/auth");
const { assertMonitoringAccess } = require("../lib/coordinationMonitoring");
const { handleError, ok } = require("../lib/http");
const { normalizePeriod } = require("../lib/indicators");
const { getIndicators } = require("../repositories/indicatorsRepository");

app.http("vcmIndicators", {
  methods: ["GET"], authLevel: "anonymous", route: "indicators",
  handler: async (request, context) => {
    try {
      assertMonitoringAccess(await requireUser(request));
      const period = normalizePeriod(new URL(request.url).searchParams.get("period"));
      return ok(await getIndicators(period));
    } catch (error) { return handleError(error, context); }
  },
});