const { AppError } = require("./http");

const PERIOD_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

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

function buildIndicators({ period = null, participation, milestones } = {}) {
  return {
    period,
    participation: buildParticipation(participation),
    milestoneFunnel: buildMilestoneFunnel(milestones),
  };
}

module.exports = { buildIndicators, buildMilestoneFunnel, buildParticipation, normalizePeriod, ratio };