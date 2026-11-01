const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePagination, validateReportDimension } = require("../src/lib/pilotReports");

test("acepta solamente las dimensiones de reporte publicadas", () => {
  assert.equal(validateReportDimension("campuses"), "campuses");
  assert.equal(validateReportDimension("subjects"), "subjects");
  assert.equal(validateReportDimension("sections"), "sections");
  assert.throws(() => validateReportDimension("users"), { code: "INVALID_REPORT_DIMENSION" });
});

test("normaliza la paginación de auditoría", () => {
  assert.deepEqual(normalizePagination("0", "500"), { page: 1, pageSize: 100 });
  assert.deepEqual(normalizePagination("3", "25"), { page: 3, pageSize: 25 });
});
