import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { completePartnerReview, getHitoTwoState, getPartnerReview, getPartnerReviewVideo, publishHitoTwoVideos, savePartnerEvaluation } from "../src/services/partnerReviewApi.js";

const require = createRequire(import.meta.url);
const { createHitoTwoTrial } = require("./helpers/hitoTwoTrial.cjs");

test("el cliente real abre, evalúa y finaliza el enlace aunque Azure reemplace Authorization", async (t) => {
  const trial = createHitoTwoTrial();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const headers = new Headers(options.headers);
    // Azure Static Web Apps reserves this header for its own backend token.
    headers.set("Authorization", "Bearer azure-platform-token-not-a-review-token");
    calls.push({ url, options, headers });
    const result = await trial.dispatch(options.method || "GET", url, options.body ? JSON.parse(options.body) : null, headers);
    return new Response(JSON.stringify(result.jsonBody), { status: result.status, headers: result.headers });
  });

  const invitation = await publishHitoTwoVideos(trial.context.projectCode, trial.sectionId);
  const review = await getPartnerReview(invitation.token);
  assert.equal(review.teams.length, 3);
  for (const team of review.teams) {
    assert.equal((await getPartnerReviewVideo(invitation.token, team.id)).status, "available");
    await savePartnerEvaluation(invitation.token, team.id, { strengths: "Presentación clara", improvements: "Ampliar la demostración", rating: 4 });
  }
  await completePartnerReview(invitation.token);
  const reopened = await getPartnerReview(invitation.token);
  assert.ok(reopened.completedAt);
  assert.equal(reopened.evaluations.length, 3);
  const teacherState = await getHitoTwoState(trial.context.projectCode, trial.sectionId);
  assert.equal(teacherState.feedbackReady, true);
  assert.equal(teacherState.closed, false);

  for (const { url, options, headers } of calls) {
    const external = url.startsWith("/api/partner-review");
    assert.equal(headers.get("X-VCM-Link-Token"), external ? invitation.token : null);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(url.includes(invitation.token), false);
    assert.equal((options.body || "").includes(invitation.token), false);
    assert.equal(options.cache, "no-store");
  }
});
