const test = require("node:test");
const assert = require("node:assert/strict");
const { getTeachingStatus } = require("../src/lib/projectProgress");

function sectionState(sectionId, completedMilestones = 0) {
  return {
    sectionId,
    milestones: [1, 2, 3].map((id) => ({ id, status: id <= completedMilestones ? "Completado" : "Pendiente" })),
  };
}

test("mantiene planificado el seguimiento sin hitos propios completados", () => {
  assert.equal(getTeachingStatus([sectionState("section-1")], ["section-1"]), "Planificado");
});

test("muestra en ejecución mientras exista una sección propia abierta", () => {
  assert.equal(getTeachingStatus([
    sectionState("section-1", 3),
    sectionState("section-2", 2),
  ], ["section-1", "section-2"]), "En ejecución");
});

test("cierra el seguimiento cuando todas las secciones propias completan el Hito 3", () => {
  assert.equal(getTeachingStatus([
    sectionState("section-1", 3),
    sectionState("section-2", 3),
    sectionState("section-from-another-teacher", 1),
  ], ["section-1", "section-2"]), "Cerrado");
});

test("no calcula seguimiento para una cuenta sin secciones asignadas", () => {
  assert.equal(getTeachingStatus([sectionState("section-1", 3)], []), null);
});
