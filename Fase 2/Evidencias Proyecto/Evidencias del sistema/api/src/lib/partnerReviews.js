const crypto = require("node:crypto");
const { AppError } = require("./http");
const { UUID_PATTERN } = require("./projectRoster");
const REVIEW_LINK_DAYS = 21;

function canCloseReview(principal, teacherAssigned = false) {
  return Boolean(principal && (
    (principal.role === "coordinator" && principal.title === "Coordinador CITT")
    || (["teacher", "coordinator"].includes(principal.role) && principal.canTeach && teacherAssigned)
  ));
}

function assertReviewHasFeedback(teams, evaluations) {
  const published = new Set(teams.map((team) => team.id.toLowerCase()));
  const evaluated = new Set(evaluations.map((evaluation) => evaluation.teamId.toLowerCase()));
  if (!published.size || !evaluated.size) {
    throw new AppError(409, "REVIEW_WITHOUT_EVALUATIONS", "Debe existir al menos una evaluación guardada para cerrar la revisión.");
  }
  if (evaluated.size !== evaluations.length || evaluations.some((evaluation) => !published.has(evaluation.teamId.toLowerCase()))) {
    throw new AppError(409, "REVIEW_INVALID_EVALUATIONS", "Las evaluaciones no coinciden con los equipos publicados. Solicita una revisión a coordinación.");
  }
}

function assertFinalReviewFeedback(review) {
  if (review.closedInternally === true && review.closedById) assertReviewHasFeedback(review.teams, review.evaluations);
  else assertReviewComplete(review.teams, review.evaluations);
}

function isFinalReviewFeedback(review) {
  if (!review?.completedAt) return false;
  try { assertFinalReviewFeedback(review); return true; }
  catch (error) { if (error instanceof AppError) return false; throw error; }
}

function createReviewToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashReviewToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AppError(404, "REVIEW_UNAVAILABLE", "Este enlace no está disponible. Solicita un nuevo enlace a la coordinación.");
  }
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readReviewToken(request) {
  // Static Web Apps replaces Authorization when proxying to managed Functions.
  // An explicit link header takes precedence, even if malformed (fail closed).
  const linkToken = request.headers.get("x-vcm-link-token");
  if (linkToken !== null) return linkToken;
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function validateReviewInput(payload = {}) {
  if (!payload || typeof payload !== "object") payload = {};
  const strengths = typeof payload.strengths === "string" ? payload.strengths.trim() : "";
  const improvements = typeof payload.improvements === "string" ? payload.improvements.trim() : "";
  if (!strengths || !improvements || strengths.length > 4000 || improvements.length > 4000) {
    throw new AppError(400, "INVALID_REVIEW_TEXT", "Completa las fortalezas y las propuestas de mejora con un máximo de 4.000 caracteres por campo.");
  }
  if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
    throw new AppError(400, "INVALID_REVIEW_RATING", "Selecciona una valoración de 1 a 5 estrellas.");
  }
  return { strengths, improvements, rating: payload.rating };
}

function assertReviewWritable(review) {
  if (review.completedAt) throw new AppError(409, "REVIEW_COMPLETED", "Esta revisión ya fue finalizada. Puedes consultar las evaluaciones guardadas.");
}

function assertReviewTeam(teams, teamId) {
  if (!UUID_PATTERN.test(String(teamId || "")) || !teams.some((team) => team.id.toLowerCase() === teamId.toLowerCase())) {
    throw new AppError(404, "REVIEW_TEAM_NOT_FOUND", "El equipo no pertenece a esta revisión.");
  }
}

function assertReviewComplete(teams, evaluations) {
  const reviewed = new Set(evaluations.map((item) => item.teamId.toLowerCase()));
  if (!teams.length || teams.some((team) => !reviewed.has(team.id.toLowerCase()))) {
    throw new AppError(409, "REVIEW_INCOMPLETE", "Guarda la evaluación de todos los equipos antes de finalizar.");
  }
}

module.exports = { REVIEW_LINK_DAYS, canCloseReview, assertReviewHasFeedback, assertFinalReviewFeedback, isFinalReviewFeedback,
  assertReviewComplete, assertReviewTeam, assertReviewWritable, createReviewToken, hashReviewToken, readReviewToken, validateReviewInput };
