const test = require("node:test");
const assert = require("node:assert/strict");
const { getProtectedRemovedSectionIds } = require("../src/lib/projectEditing");

test("permite retirar una sección sin actividad", () => {
  assert.deepEqual(getProtectedRemovedSectionIds([
    { id: "section-1", hasActivity: false },
    { id: "section-2", hasActivity: true },
  ], ["section-2"]), []);
});

test("protege una sección con actividad aunque cambie el uso de mayúsculas", () => {
  assert.deepEqual(getProtectedRemovedSectionIds([
    { id: "SECTION-1", hasActivity: true },
    { id: "section-2", hasActivity: false },
  ], ["section-2"]), ["SECTION-1"]);
});
