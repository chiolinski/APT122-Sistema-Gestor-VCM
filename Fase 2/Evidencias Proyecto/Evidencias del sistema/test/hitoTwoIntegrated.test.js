import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createHitoTwoTrial } = require("./helpers/hitoTwoTrial.cjs");

test("el ensayo integrado pasa por los controladores, repositorios y reglas reales hasta el cierre de tres equipos", async () => {
  const trial = createHitoTwoTrial();
  const sectionPath = `/api/projects/${trial.context.projectCode}/sections/${trial.sectionId}/hito2`;
  const progressPath = `/api/projects/${trial.context.projectCode}/progress`;
  const progress = { sectionId: trial.sectionId, advance: "Avance ficticio", conclusions: "Conclusiones ficticias", feedbackReviewed: true };
  let result = await trial.dispatch("GET", sectionPath);
  assert.equal(result.status, 200); assert.equal(result.jsonBody.data.videos.length, 3);
  assert.equal(result.jsonBody.data.feedbackReady, false);
  result = await trial.dispatch("POST", sectionPath);
  assert.equal(result.status, 201);
  const { token, id: reviewId } = result.jsonBody.data;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await trial.dispatch("POST", progressPath, { ...progress, reviewId })).jsonBody.error.code, "FEEDBACK_NOT_COMPLETED");
  assert.equal((await trial.dispatch("POST", "/api/partner-review/complete", {}, headers)).jsonBody.error.code, "REVIEW_INCOMPLETE");
  const review = (await trial.dispatch("GET", "/api/partner-review", null, headers)).jsonBody.data;
  const filenames = ["EjemploEquipo1.mp4", "OtroEjemploEquipo2.mp4", "EjemploEquipo3.mp4"];
  for (const [index, team] of review.teams.entries()) {
    const video = await trial.dispatch("GET", `/api/partner-review/teams/${team.id}/video`, null, headers);
    assert.equal(video.jsonBody.data.filename, filenames[index]);
    result = await trial.dispatch("PUT", `/api/partner-review/teams/${team.id}`, { strengths: `Fortaleza del Equipo ${index + 1}`, improvements: `Mejora del Equipo ${index + 1}`, rating: index + 3 }, headers);
    assert.equal(result.status, 200);
    assert.equal((await trial.dispatch("GET", sectionPath)).jsonBody.data.review.evaluations.length, 0);
  }
  assert.equal((await trial.dispatch("GET", sectionPath)).jsonBody.data.feedbackReady, false);
  assert.equal((await trial.dispatch("POST", "/api/partner-review/complete", {}, headers)).status, 200);
  const summary = (await trial.dispatch("GET", sectionPath)).jsonBody.data;
  assert.equal(summary.feedbackReady, true); assert.deepEqual(summary.review.evaluations.map((item) => item.rating), [3, 4, 5]);
  const changed = await trial.dispatch("PUT", `/api/partner-review/teams/${review.teams[0].id}`, { strengths: "Cambio", improvements: "Cambio", rating: 1 }, headers);
  assert.equal(changed.jsonBody.error.code, "REVIEW_COMPLETED");
  assert.equal((await trial.dispatch("POST", progressPath, { ...progress, reviewId, feedbackReviewed: false })).jsonBody.error.code, "FEEDBACK_ACK_REQUIRED");
  result = await trial.dispatch("POST", progressPath, { ...progress, reviewId });
  assert.equal(result.status, 200);
  assert.equal(result.jsonBody.data.project.sectionStates.length, 1);
  assert.equal(result.jsonBody.data.project.sectionStates[0].milestones[1].status, "Completado");
  assert.equal(result.jsonBody.data.project.sectionStates[0].progress.reviewId, reviewId);
  assert.ok(result.jsonBody.data.project.sectionStates[0].progress.feedbackReviewedAt);
  assert.equal((await trial.dispatch("GET", sectionPath)).jsonBody.data.closed, true);
  assert.equal(trial.info().otherSectionClosed, false); assert.equal(trial.info().hitoThreeClosed, false); assert.equal(trial.info().globalClosed, false);
  assert.equal((await trial.dispatch("GET", `/api/projects/${trial.context.projectCode}/sections/${trial.otherSectionId}/hito2`)).status, 403);
});

test("el flujo integrado cierra dos de tres evaluaciones, bloquea al socio y requiere otro paso para cerrar Hito 2", async () => {
  const trial = createHitoTwoTrial();
  const sectionPath = `/api/projects/${trial.context.projectCode}/sections/${trial.sectionId}/hito2`;
  const published = await trial.dispatch("POST", sectionPath);
  const { token, id: reviewId, expiresAt } = published.jsonBody.data;
  assert.ok(Date.parse(expiresAt) - Date.now() <= 21 * 86400000);
  const headers = { "X-VCM-Link-Token": token };
  const review = (await trial.dispatch("GET", "/api/partner-review", null, headers)).jsonBody.data;
  assert.equal((await trial.dispatch("POST", `${sectionPath}/close-review`, { reviewId })).jsonBody.error.code, "REVIEW_WITHOUT_EVALUATIONS");
  for (const [index, team] of review.teams.slice(0, 2).entries()) {
    assert.equal((await trial.dispatch("PUT", `/api/partner-review/teams/${team.id}`, {
      strengths: "Fortaleza", improvements: "Mejora", rating: index ? 2 : 4,
    }, headers)).status, 200);
  }
  const progressPath = `/api/projects/${trial.context.projectCode}/progress`;
  const input = { sectionId: trial.sectionId, advance: "Avance", conclusions: "Conclusiones", feedbackReviewed: true, reviewId };
  assert.equal((await trial.dispatch("POST", progressPath, input)).jsonBody.error.code, "FEEDBACK_NOT_COMPLETED");
  assert.equal((await trial.dispatch("POST", `${sectionPath}/close-review`, { reviewId })).status, 200);
  assert.equal(trial.info().closed, false);
  assert.equal(trial.info().otherSectionClosed, false);
  const state = (await trial.dispatch("GET", sectionPath)).jsonBody.data;
  assert.equal(state.feedbackReady, true); assert.equal(state.review.evaluations.length, 2);
  assert.equal(state.review.teams.length, 3); assert.equal(state.review.closedInternally, true);
  assert.deepEqual(state.review.evaluations.map((evaluation) => evaluation.rating), [4, 2]);
  assert.equal((await trial.dispatch("PUT", `/api/partner-review/teams/${review.teams[2].id}`, {
    strengths: "Nueva", improvements: "Nueva", rating: 5,
  }, headers)).jsonBody.error.code, "REVIEW_COMPLETED");
  assert.equal((await trial.dispatch("POST", progressPath, { ...input, feedbackReviewed: false })).jsonBody.error.code, "FEEDBACK_ACK_REQUIRED");
  assert.equal((await trial.dispatch("POST", progressPath, input)).status, 200);
  assert.equal(trial.info().closed, true); assert.equal(trial.info().hitoThreeClosed, false);
  assert.equal(trial.info().globalClosed, false); assert.equal(trial.info().otherSectionClosed, false);
  const audit = trial.snapshot.audits.find((event) => event.action === "PARTNER_REVIEW_CLOSED_INTERNALLY");
  assert.equal(audit.data.evaluatedCount, 2); assert.equal(audit.data.unevaluatedCount, 1);
});
