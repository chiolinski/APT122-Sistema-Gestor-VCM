const { AppError } = require("./http");

const PERIOD_PATTERN = /^[A-Za-z0-9-]{1,20}$/;
const MIN_RATING_SAMPLE = 3;

function ratio(numerator, denominator) {
  const top = Number(numerator) || 0;
  const bottom = Number(denominator) || 0;
  if (bottom <= 0) return { numerator: top, denominator: 0, percent: null, evaluable: false };
  return { numerator: top, denominator: bottom, percent: Math.round((top / bottom) * 100), evaluable: true };
}

function normalizePeriod(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const period = String(value).trim();
  if (!PERIOD_PATTERN.test(period)) {
    throw new AppError(400, "INVALID_PERIOD", "El período académico indicado no es válido.");
  }
  return period;
}

function buildParticipation(row = {}) {
  return ratio(row.assigned, row.enrolled);
}

function buildMilestoneFunnel(rows = []) {
  return [1, 2, 3].map((milestone) => {
    const row = rows.find((item) => Number(item.milestone) === milestone) || {};
    return { milestone, ...ratio(row.completed, row.total) };
  });
}

function buildVideoDelivery(row = {}) {
  return ratio(row.delivered, row.total);
}

function buildDropout(row = {}) {
  return ratio(row.dropped, row.enrolled);
}

function buildPartnerResponse(row = {}) {
  return ratio(row.answered, row.sent);
}

function buildPartnerRating(row = {}) {
  const count = Number(row.evaluations) || 0;
  const sum = Number(row.ratingSum) || 0;
  if (count < MIN_RATING_SAMPLE) return { count, average: null, sufficient: false };
  return { count, average: Math.round((sum / count) * 10) / 10, sufficient: true };
}

function buildIndicators({ period = null, participation, milestones, videos, dropout, responses, ratings } = {}) {
  return {
    period,
    participation: buildParticipation(participation),
    milestoneFunnel: buildMilestoneFunnel(milestones),
    videoDelivery: buildVideoDelivery(videos),
    dropout: buildDropout(dropout),
    partnerResponse: buildPartnerResponse(responses),
    partnerRating: buildPartnerRating(ratings),
  };
}

module.exports = {
  buildDropout, buildIndicators, buildMilestoneFunnel, buildParticipation, buildPartnerRating, buildPartnerResponse,
  buildVideoDelivery, normalizePeriod, ratio,
};
