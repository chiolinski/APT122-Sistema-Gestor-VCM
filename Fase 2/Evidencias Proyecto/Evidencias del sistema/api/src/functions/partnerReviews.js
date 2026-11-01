const { app } = require("@azure/functions");
const { requireRole } = require("../lib/auth");
const { created, handleError, ok, readJson } = require("../lib/http");
const { readReviewToken, validateReviewInput } = require("../lib/partnerReviews");
const { completePartnerReview, createPartnerReview, getPartnerReview, getPartnerReviewVideo, listPartnerReviews, revokePartnerReview, savePartnerEvaluation } = require("../repositories/partnerReviewRepository");

app.http("managePartnerReviews", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "projects/{id}/partner-reviews",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      if (request.method === "GET") return ok(await listPartnerReviews(request.params.id, principal));
      const payload = await readJson(request);
      return created(await createPartnerReview(request.params.id, payload?.sectionId, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("revokePartnerReview", {
  methods: ["DELETE"], authLevel: "anonymous", route: "projects/{id}/partner-reviews/{reviewId}",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      return ok(await revokePartnerReview(request.params.id, request.params.reviewId, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("partnerReview", {
  methods: ["GET"], authLevel: "anonymous", route: "partner-review",
  handler: async (request, context) => {
    try { return ok(await getPartnerReview(readReviewToken(request))); }
    catch (error) { return handleError(error, context); }
  },
});

app.http("savePartnerEvaluation", {
  methods: ["PUT"], authLevel: "anonymous", route: "partner-review/teams/{teamId}",
  handler: async (request, context) => {
    try {
      return ok(await savePartnerEvaluation(readReviewToken(request), request.params.teamId, validateReviewInput(await readJson(request))));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("partnerReviewVideo", {
  methods: ["GET"], authLevel: "anonymous", route: "partner-review/teams/{teamId}/video",
  handler: async (request, context) => {
    try { return ok(await getPartnerReviewVideo(readReviewToken(request), request.params.teamId)); }
    catch (error) { return handleError(error, context); }
  },
});

app.http("completePartnerReview", {
  methods: ["POST"], authLevel: "anonymous", route: "partner-review/complete",
  handler: async (request, context) => {
    try { return ok(await completePartnerReview(readReviewToken(request))); }
    catch (error) { return handleError(error, context); }
  },
});
