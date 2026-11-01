const { app } = require("@azure/functions");
const { requireRole, requireTeachingCapability } = require("../lib/auth");
const { ok, created, readJson, handleError } = require("../lib/http");
const { readReviewToken } = require("../lib/partnerReviews");
const { closeSectionPartnerReview, getHitoTwoState, createPartnerReview } = require("../repositories/partnerReviewRepository");
const { createVideoDeliveryLinks, getVideoDelivery, beginVideoUpload, confirmVideoUpload } = require("../repositories/videoDeliveryRepository");

app.http("sectionHitoTwo", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "projects/{id}/sections/{sectionId}/hito2",
  handler: async (request, context) => {
    try {
      const principal = request.method === "GET" ? await requireRole(request, ["admin", "coordinator", "teacher"])
        : await requireTeachingCapability(request);
      return request.method === "GET" ? ok(await getHitoTwoState(request.params.id, request.params.sectionId, principal))
        : created(await createPartnerReview(request.params.id, request.params.sectionId, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("sectionVideoDeliveryLinks", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/sections/{sectionId}/video-delivery-links",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      return created(await createVideoDeliveryLinks(request.params.id, request.params.sectionId, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("closeSectionPartnerReview", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/sections/{sectionId}/hito2/close-review",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["teacher", "coordinator"]);
      const payload = await readJson(request);
      return ok(await closeSectionPartnerReview(request.params.id, request.params.sectionId, payload?.reviewId, principal));
    } catch (error) { return handleError(error, context); }
  },
});

for (const [name, method, route, operation] of [
  ["studentVideoDelivery", "GET", "video-delivery", (token) => getVideoDelivery(token)],
  ["beginStudentVideoUpload", "POST", "video-delivery/upload", (token, payload) => beginVideoUpload(token, payload)],
  ["confirmStudentVideoUpload", "POST", "video-delivery/confirm", (token, payload) => confirmVideoUpload(token, payload?.attemptId)],
]) {
  app.http(name, { methods: [method], authLevel: "anonymous", route,
    handler: async (request, context) => {
      try { return ok(await operation(readReviewToken(request), method === "POST" ? await readJson(request) : undefined)); }
      catch (error) { return handleError(error, context); }
    },
  });
}
