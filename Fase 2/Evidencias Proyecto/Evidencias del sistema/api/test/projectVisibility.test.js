const test = require("node:test");
const assert = require("node:assert/strict");
const { scopeSectionRows } = require("../src/lib/projectVisibility");

const rows = [
  { sectionId: "section-1", value: "propia" },
  { sectionId: "section-2", value: "otra" },
];

test("un docente recibe únicamente datos de sus secciones", () => {
  assert.deepEqual(scopeSectionRows(rows, ["SECTION-1"], true), [rows[0]]);
});

test("administración y coordinación conservan todas las secciones", () => {
  assert.deepEqual(scopeSectionRows(rows, ["section-1"], false), rows);
});
