const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { getIndicators } = require("../src/repositories/indicatorsRepository");
const { PERIOD, EMPTY_PERIOD, PROJECT_CODE, SCHOOL, seed, cleanup, close } = require("./fixtures");

before(seed);
after(async () => {
  await cleanup();
  await close();
});

test("cada métrica del proyecto sale de la base real con los valores sembrados", async () => {
  const indicators = await getIndicators(PERIOD);
  assert.equal(indicators.period, PERIOD);
  assert.deepEqual(indicators.projects.map((project) => project.code), [PROJECT_CODE]);
  const [project] = indicators.projects;
  assert.deepEqual(project.participation, { numerator: 6, denominator: 8, percent: 75, evaluable: true });
  assert.deepEqual(project.dropout, { numerator: 2, denominator: 10, percent: 20, evaluable: true });
  assert.deepEqual(project.milestones.map((m) => [m.milestone, m.numerator, m.denominator]), [[1, 1, 1], [2, 0, 1]]);
  assert.deepEqual(project.closure, { numerator: 0, denominator: 1, percent: 0, evaluable: true });
  assert.deepEqual(project.videoDelivery, { numerator: 2, denominator: 3, percent: 67, evaluable: true });
  assert.deepEqual(project.partnerResponse, { numerator: 1, denominator: 1, percent: 100, evaluable: true });
  assert.deepEqual(project.partnerRating, { count: 3, average: 4.3, sufficient: true });
});

test("el resumen cuenta proyectos que cumplen y la distribución por escuela", async () => {
  const indicators = await getIndicators(PERIOD);
  assert.deepEqual(indicators.participation.projects, { numerator: 0, denominator: 1, percent: 0, evaluable: true });
  assert.deepEqual(indicators.participation.detail, { numerator: 6, denominator: 8, percent: 75, evaluable: true });
  assert.deepEqual(indicators.dropout.projects, { numerator: 1, denominator: 1, percent: 100, evaluable: true });
  assert.deepEqual(indicators.projectsBySchool, {
    total: 1,
    schools: [{ school: SCHOOL, numerator: 1, denominator: 1, percent: 100, evaluable: true }],
  });
});

test("un período sin proyectos queda No evaluable", async () => {
  const indicators = await getIndicators(EMPTY_PERIOD);
  assert.deepEqual(indicators.projects, []);
  assert.equal(indicators.participation.projects.evaluable, false);
  assert.deepEqual(indicators.projectsBySchool, { total: 0, schools: [] });
});

test("los datos de otro período no se mezclan con el período activo", async () => {
  const indicators = await getIndicators();
  assert.ok(!indicators.projects.some((project) => project.code === PROJECT_CODE));
});
