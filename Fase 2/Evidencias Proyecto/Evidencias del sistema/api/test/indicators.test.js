const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIndicators, buildMilestoneFunnel, normalizePeriod, ratio } = require("../src/lib/indicators");

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

test("el embudo siempre devuelve los tres hitos", () => {
  const funnel = buildMilestoneFunnel([
    { milestone: 1, total: 20, completed: 18 },
    { milestone: 2, total: 20, completed: 12 },
  ]);
  assert.deepEqual(funnel.map((step) => step.milestone), [1, 2, 3]);
  assert.equal(funnel[0].percent, 90);
  assert.equal(funnel[1].percent, 60);
  assert.equal(funnel[2].evaluable, false);
});

test("sin período todas las métricas quedan No evaluable", () => {
  const indicators = buildIndicators({ period: null });
  assert.equal(indicators.participation.evaluable, false);
  assert.ok(indicators.milestoneFunnel.every((step) => !step.evaluable));
});

test("normalizePeriod acepta vacío y rechaza valores extraños", () => {
  assert.equal(normalizePeriod(""), null);
  assert.equal(normalizePeriod(" 2026-2 "), "2026-2");
  assert.throws(() => normalizePeriod("2026-2'; DROP TABLE"), { code: "INVALID_PERIOD" });
});