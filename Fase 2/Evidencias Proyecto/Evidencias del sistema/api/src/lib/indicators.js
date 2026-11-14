const { AppError } = require("./http");

const PERIOD_PATTERN = /^[A-Za-z0-9-]{1,20}$/;
const MIN_RATING_SAMPLE = 3;
const MILESTONE_FIELDS = { 1: "milestoneOne", 2: "milestoneTwo" };

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

function buildPartnerRating(row = {}) {
  const count = Number(row.evaluations) || 0;
  const sum = Number(row.ratingSum) || 0;
  if (count < MIN_RATING_SAMPLE) return { count, average: null, sufficient: false };
  return { count, average: Math.round((sum / count) * 10) / 10, sufficient: true };
}

function buildProject(row = {}) {
  const participations = Number(row.participations) || 0;
  const dropped = Number(row.dropped) || 0;
  return {
    code: row.code,
    name: row.name,
    school: row.school || "Sin escuela",
    participation: ratio(row.assigned, participations - dropped),
    dropout: ratio(dropped, participations),
    milestones: [1, 2].map((milestone) => ({
      milestone, ...ratio(row[MILESTONE_FIELDS[milestone]], row.sections),
    })),
    closure: ratio(row.closedSections, row.sections),
    videoDelivery: ratio(row.videos, row.teams),
    partnerResponse: ratio(row.reviewsAnswered, row.reviewsSent),
    partnerRating: buildPartnerRating(row),
  };
}

function isComplete(metric) {
  return metric.numerator === metric.denominator;
}

function summarize(metrics, meets = isComplete) {
  const evaluable = metrics.filter((metric) => metric.evaluable);
  const numerator = evaluable.reduce((sum, metric) => sum + metric.numerator, 0);
  const denominator = evaluable.reduce((sum, metric) => sum + metric.denominator, 0);
  return {
    projects: ratio(evaluable.filter(meets).length, evaluable.length),
    detail: ratio(numerator, denominator),
  };
}

function summarizeRating(rows, projects) {
  const evaluations = rows.reduce((sum, row) => sum + (Number(row.evaluations) || 0), 0);
  const ratingSum = rows.reduce((sum, row) => sum + (Number(row.ratingSum) || 0), 0);
  return {
    ...buildPartnerRating({ evaluations, ratingSum }),
    projects: projects.filter((project) => project.partnerRating.count > 0).length,
  };
}

function buildSchoolDistribution(rows = []) {
  const total = rows.reduce((sum, row) => sum + (Number(row.projects) || 0), 0);
  const schools = rows.map((row) => ({
    school: row.school || "Sin escuela",
    ...ratio(row.projects, total),
  }));
  return { total, schools };
}

function buildIndicators({ period = null, projects: projectRows = [], schools } = {}) {
  const projects = projectRows.map(buildProject);
  return {
    period,
    participation: summarize(projects.map((project) => project.participation)),
    milestoneFunnel: [1, 2].map((milestone) => ({
      milestone, ...summarize(projects.map((project) => project.milestones[milestone - 1])),
    })),
    closure: summarize(projects.map((project) => project.closure)),
    videoDelivery: summarize(projects.map((project) => project.videoDelivery)),
    dropout: summarize(projects.map((project) => project.dropout), (metric) => metric.numerator > 0),
    partnerResponse: summarize(projects.map((project) => project.partnerResponse)),
    partnerRating: summarizeRating(projectRows, projects),
    projects,
    projectsBySchool: buildSchoolDistribution(schools),
  };
}

module.exports = {
  buildIndicators, buildPartnerRating, buildProject, buildSchoolDistribution, normalizePeriod, ratio, summarize,
};
