const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDropout, buildIndicators, buildMilestoneFunnel, buildPartnerRating, buildPartnerResponse, buildVideoDelivery, normalizePeriod, ratio,
} = require("../src/lib/indicators");

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
  assert.equal(indicators.videoDelivery.evaluable, false);
  assert.equal(indicators.dropout.evaluable, false);
  assert.equal(indicators.partnerResponse.evaluable, false);
  assert.equal(indicators.partnerRating.sufficient, false);
});

test("normalizePeriod acepta vacío y rechaza valores extraños", () => {
  assert.equal(normalizePeriod(""), null);
  assert.equal(normalizePeriod(" 2026-2 "), "2026-2");
  assert.throws(() => normalizePeriod("2026-2'; DROP TABLE"), { code: "INVALID_PERIOD" });
});
test("M6 cuenta equipos con video entregado sobre equipos conformados", () => {
  assert.deepEqual(buildVideoDelivery({ total: 6, delivered: 5 }), { numerator: 5, denominator: 6, percent: 83, evaluable: true });
  assert.equal(buildVideoDelivery({ total: 0, delivered: 0 }).evaluable, false);
});

test("M2 calcula la deserción registrada sobre los matriculados", () => {
  assert.deepEqual(buildDropout({ enrolled: 12, dropped: 2 }), { numerator: 2, denominator: 12, percent: 17, evaluable: true });
  assert.equal(buildDropout({ enrolled: 12, dropped: 0 }).percent, 0);
});

test("M7 cuenta revisiones respondidas por el socio sobre las enviadas", () => {
  assert.deepEqual(buildPartnerResponse({ sent: 4, answered: 3 }), { numerator: 3, denominator: 4, percent: 75, evaluable: true });
  assert.equal(buildPartnerResponse({ sent: 0, answered: 0 }).evaluable, false);
});

test("M8 promedia la valoración con un decimal", () => {
  assert.deepEqual(buildPartnerRating({ evaluations: 4, ratingSum: 16 }), { count: 4, average: 4, sufficient: true });
  assert.equal(buildPartnerRating({ evaluations: 3, ratingSum: 13 }).average, 4.3);
});

test("M8 con menos de 3 evaluaciones es Muestra insuficiente", () => {
  assert.deepEqual(buildPartnerRating({ evaluations: 2, ratingSum: 10 }), { count: 2, average: null, sufficient: false });
});
