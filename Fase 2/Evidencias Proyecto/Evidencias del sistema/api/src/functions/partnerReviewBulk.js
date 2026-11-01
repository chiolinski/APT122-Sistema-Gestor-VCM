const { app } = require("@azure/functions");
const { requireAdmin } = require("../lib/auth");
const { handleError, ok, readJson } = require("../lib/http");
const { listBulkReviewPeriods, previewBulkReviewClosure, closeBulkPartnerReviews } = require("../repositories/partnerReviewBulkRepository");

app.http("bulkPartnerReviewPeriods", {
  methods: ["GET"], authLevel: "anonymous", route: "partner-reviews/bulk-close/periods",
  handler: async (request, context) => {
    try { return ok(await listBulkReviewPeriods(await requireAdmin(request))); }
    catch (error) { return handleError(error, context); }
  },
});
app.http("previewBulkPartnerReviewClosure", {
  methods: ["POST"], authLevel: "anonymous", route: "partner-reviews/bulk-close/preview",
  handler: async (request, context) => {
    try {
      const principal = await requireAdmin(request);
      const payload = await readJson(request);
      return ok(await previewBulkReviewClosure(payload?.period, principal));
    } catch (error) { return handleError(error, context); }
  },
});
app.http("closeBulkPartnerReviews", {
  methods: ["POST"], authLevel: "anonymous", route: "partner-reviews/bulk-close",
  handler: async (request, context) => {
    try {
      const principal = await requireAdmin(request);
      return ok(await closeBulkPartnerReviews(await readJson(request), principal));
    } catch (error) { return handleError(error, context); }
  },
});
