const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildIndicators, buildPartnerRating, buildProject, buildSchoolDistribution, normalizePeriod, ratio, summarize,
} = require("../src/lib/indicators");

const pilotProject = {
  code: "VCM-2026-001", name: "Proyecto A", school: "Informática",
  participations: 12, assigned: 8, dropped: 2, sections: 2,
  milestoneOne: 2, milestoneTwo: 0, closedSections: 0,
  teams: 6, videos: 5, reviewsSent: 1, reviewsAnswered: 1, evaluations: 4, ratingSum: 16,
};

const secondProject = {
  code: "VCM-2026-002", name: "Proyecto B", school: null,
  participations: 5, assigned: 5, dropped: 0, sections: 1,
  milestoneOne: 1, milestoneTwo: 1, closedSections: 1,
  teams: 2, videos: 2, reviewsSent: 1, reviewsAnswered: 0, evaluations: 2, ratingSum: 6,
};

test("ratio calcula el porcentaje redondeado", () => {
  assert.deepEqual(ratio(112, 140), { numerator: 112, denominator: 140, percent: 80, evaluable: true });
  assert.equal(ratio(1, 3).percent, 33);
});

test("ratio con denominador cero es No evaluable", () => {
  assert.deepEqual(ratio(0, 0), { numerator: 0, denominator: 0, percent: null, evaluable: false });
});

test("ratio admite el 100 %", () => {
  assert.equal(ratio(20, 20).percent, 100);
});

test("normalizePeriod acepta vacío y rechaza valores extraños", () => {
  assert.equal(normalizePeriod(""), null);
  assert.equal(normalizePeriod(" 2026-2 "), "2026-2");
  assert.throws(() => normalizePeriod("2026-2'; DROP TABLE"), { code: "INVALID_PERIOD" });
});

test("cada proyecto calcula sus métricas con sus propias participaciones", () => {
  const project = buildProject(pilotProject);
  assert.deepEqual(project.participation, { numerator: 8, denominator: 10, percent: 80, evaluable: true });
  assert.deepEqual(project.dropout, { numerator: 2, denominator: 12, percent: 17, evaluable: true });
  assert.deepEqual(project.milestones.map((step) => step.percent), [100, 0]);
  assert.deepEqual(project.closure, { numerator: 0, denominator: 2, percent: 0, evaluable: true });
  assert.equal(project.videoDelivery.percent, 83);
  assert.equal(project.partnerResponse.percent, 100);
  assert.equal(project.partnerRating.average, 4);
  assert.equal(buildProject(secondProject).school, "Sin escuela");
});

test("summarize cuenta proyectos que cumplen e ignora los no evaluables", () => {
  const summary = summarize([ratio(8, 10), ratio(5, 5), ratio(0, 0)]);
  assert.deepEqual(summary.projects, { numerator: 1, denominator: 2, percent: 50, evaluable: true });
  assert.deepEqual(summary.detail, { numerator: 13, denominator: 15, percent: 87, evaluable: true });
});

test("las tarjetas resumen proyectos y conservan el detalle sumado", () => {
  const indicators = buildIndicators({ period: "2026-2", projects: [pilotProject, secondProject] });
  assert.deepEqual([indicators.participation.projects.numerator, indicators.participation.projects.denominator], [1, 2]);
  assert.deepEqual([indicators.participation.detail.numerator, indicators.participation.detail.denominator], [13, 15]);
  assert.deepEqual(indicators.milestoneFunnel.map((step) => step.milestone), [1, 2]);
  assert.deepEqual(indicators.milestoneFunnel.map((step) => step.projects.numerator), [2, 1]);
  assert.deepEqual(indicators.closure.projects, { numerator: 1, denominator: 2, percent: 50, evaluable: true });
  assert.deepEqual([indicators.closure.detail.numerator, indicators.closure.detail.denominator], [1, 3]);
  assert.equal(indicators.milestoneFunnel[0].detail.denominator, 3);
  assert.equal(indicators.videoDelivery.projects.numerator, 1);
  assert.equal(indicators.partnerResponse.projects.numerator, 1);
  assert.equal(indicators.projects.length, 2);
});

test("la deserción cuenta proyectos con al menos un desertor", () => {
  const indicators = buildIndicators({ period: "2026-2", projects: [pilotProject, secondProject] });
  assert.deepEqual(indicators.dropout.projects, { numerator: 1, denominator: 2, percent: 50, evaluable: true });
  assert.deepEqual(indicators.dropout.detail, { numerator: 2, denominator: 17, percent: 12, evaluable: true });
});

test("la valoración suma las evaluaciones de todos los proyectos", () => {
  const rating = buildIndicators({ period: "2026-2", projects: [pilotProject, secondProject] }).partnerRating;
  assert.deepEqual(rating, { count: 6, average: 3.7, sufficient: true, projects: 2 });
});

test("M8 con menos de 3 evaluaciones es Muestra insuficiente", () => {
  assert.deepEqual(buildPartnerRating({ evaluations: 2, ratingSum: 10 }), { count: 2, average: null, sufficient: false });
  assert.equal(buildPartnerRating({ evaluations: 3, ratingSum: 13 }).average, 4.3);
});

test("sin proyectos en ejecución todas las métricas quedan No evaluable", () => {
  const indicators = buildIndicators({ period: null });
  assert.equal(indicators.participation.projects.evaluable, false);
  assert.ok(indicators.milestoneFunnel.every((step) => !step.projects.evaluable));
  assert.equal(indicators.closure.projects.evaluable, false);
  assert.equal(indicators.videoDelivery.detail.evaluable, false);
  assert.equal(indicators.dropout.projects.evaluable, false);
  assert.equal(indicators.partnerResponse.projects.evaluable, false);
  assert.equal(indicators.partnerRating.sufficient, false);
  assert.deepEqual(indicators.projects, []);
});

test("M10 reparte los proyectos por escuela y nombra las asignaturas sin escuela", () => {
  const distribution = buildSchoolDistribution([
    { school: "Informática y Telecomunicaciones", projects: 3 },
    { school: null, projects: 1 },
  ]);
  assert.equal(distribution.total, 4);
  assert.deepEqual(distribution.schools.map((item) => [item.school, item.numerator, item.percent]), [
    ["Informática y Telecomunicaciones", 3, 75],
    ["Sin escuela", 1, 25],
  ]);
});
