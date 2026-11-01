const { AppError } = require("./http");

const REPORT_DIMENSIONS = ["campuses", "subjects", "sections"];

function validateReportDimension(value) {
  if (!REPORT_DIMENSIONS.includes(value)) {
    throw new AppError(400, "INVALID_REPORT_DIMENSION", "El reporte solicitado no es válido.");
  }
  return value;
}

function normalizePagination(page, pageSize) {
  return {
    page: Math.max(1, Number.parseInt(page, 10) || 1),
    pageSize: Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 25)),
  };
}

module.exports = { REPORT_DIMENSIONS, normalizePagination, validateReportDimension };
