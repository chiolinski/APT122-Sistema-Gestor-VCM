export async function request(path, { token, ...options } = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    cache: "no-store",
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}),
      // Azure reserves Authorization for its managed Functions proxy.
      ...(token ? { "X-VCM-Link-Token": token } : {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.data) {
    const error = new Error(payload.error?.message || "No fue posible acceder a la revisión. Intenta nuevamente.");
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

export const getPartnerReview = (token) => request("partner-review", { token });
export const getPartnerReviewVideo = (token, teamId) => request(`partner-review/teams/${encodeURIComponent(teamId)}/video`, { token });
export const savePartnerEvaluation = (token, teamId, evaluation) => request(`partner-review/teams/${encodeURIComponent(teamId)}`, {
  token, method: "PUT", body: JSON.stringify(evaluation),
});
export const completePartnerReview = (token) => request("partner-review/complete", { token, method: "POST" });
export const getBulkReviewPeriods = () => request("partner-reviews/bulk-close/periods");
export const previewBulkReviewClosure = (period) => request("partner-reviews/bulk-close/preview", { method: "POST", body: JSON.stringify({ period }) });
export const closeBulkPartnerReviews = (input) => request("partner-reviews/bulk-close", { method: "POST", body: JSON.stringify(input) });
export const listPartnerReviews = (projectId) => request(`projects/${encodeURIComponent(projectId)}/partner-reviews`);
export const createPartnerReview = (projectId, sectionId) => request(`projects/${encodeURIComponent(projectId)}/partner-reviews`, {
  method: "POST", body: JSON.stringify({ sectionId }),
});
export const revokePartnerReview = (projectId, reviewId) => request(`projects/${encodeURIComponent(projectId)}/partner-reviews/${encodeURIComponent(reviewId)}`, { method: "DELETE" });

const sectionPath = (projectId, sectionId) => `projects/${encodeURIComponent(projectId)}/sections/${encodeURIComponent(sectionId)}`;
export const getHitoTwoState = (projectId, sectionId) => request(`${sectionPath(projectId, sectionId)}/hito2`);
export const publishHitoTwoVideos = (projectId, sectionId) => request(`${sectionPath(projectId, sectionId)}/hito2`, { method: "POST" });
export const closeSectionPartnerReview = (projectId, sectionId, reviewId) => request(`${sectionPath(projectId, sectionId)}/hito2/close-review`, {
  method: "POST", body: JSON.stringify({ reviewId }),
});
export const createVideoDeliveryLinks = (projectId, sectionId) => request(`${sectionPath(projectId, sectionId)}/video-delivery-links`, { method: "POST" });
export const getVideoDelivery = (token) => request("video-delivery", { token });
export const beginVideoUpload = (token, file) => request("video-delivery/upload", { token, method: "POST", body: JSON.stringify({ name: file.name, size: file.size }) });
export const confirmVideoUpload = (token, attemptId) => request("video-delivery/confirm", { token, method: "POST", body: JSON.stringify({ attemptId }) });
