const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertMonitoringAccess,
  buildCoordinationMonitoring,
  filterMonitoringReport,
  normalizeMonitoringFilters,
} = require("../src/lib/coordinationMonitoring");

function project(overrides = {}) {
  return {
    databaseId: "project-db-1",
    id: "VCM-2026-001",
    name: "Proyecto de prueba",
    status: "EN_EJECUCION",
    subjectCode: "DSY1105",
    subjectName: "Desarrollo de aplicaciones móviles",
    startDate: "2026-08-01",
    endDate: null,
    availableFrom: null,
    ...overrides,
  };
}

function section(id, completedMilestones = 0, overrides = {}) {
  return {
    projectId: "project-db-1",
    id,
    code: `DSY1105-${id}`,
    shift: "Diurno",
    campusName: "Concepción",
    studentCount: 20,
    teamCount: completedMilestones ? 5 : 0,
    assignedStudentCount: completedMilestones ? 20 : 0,
    hito1Status: completedMilestones >= 1 ? "COMPLETADO" : "PENDIENTE",
    hito2Status: completedMilestones >= 2 ? "COMPLETADO" : "PENDIENTE",
    hito3Status: completedMilestones >= 3 ? "COMPLETADO" : "PENDIENTE",
    ...overrides,
  };
}

function teacher(sectionId, overrides = {}) {
  return {
    projectId: "project-db-1",
    sectionId,
    id: "teacher-1",
    name: "Docente de prueba",
    email: "docente@vcm.cl",
    accountLinked: true,
    ...overrides,
  };
}

test("permite el panel a coordinación y administración", () => {
  assert.equal(assertMonitoringAccess({ role: "coordinator" }).role, "coordinator");
  assert.equal(assertMonitoringAccess({ role: "admin" }).role, "admin");
});

test("rechaza el panel para docentes", () => {
  assert.throws(
    () => assertMonitoringAccess({ role: "teacher" }),
    (error) => error.status === 403 && error.code === "MONITORING_ACCESS_DENIED",
  );
});

test("alerta cuando todas las secciones están listas para programar Hito 2", () => {
  const result = buildCoordinationMonitoring({
    projectRows: [project()],
    sectionRows: [section("001D", 1), section("002D", 1)],
    teacherRows: [teacher("001D"), teacher("002D")],
  }, "2026-08-17");

  assert.equal(result.projects[0].readyForMilestoneTwo, true);
  assert.equal(result.summary.readyProjects, 1);
  assert.ok(result.alerts.some((alert) => alert.type === "READY_FOR_HITO_2"));
});

test("calcula el avance solamente con las secciones responsables del proyecto", () => {
  const result = buildCoordinationMonitoring({
    projectRows: [project()],
    sectionRows: [section("001D", 1)],
    teacherRows: [teacher("001D")],
  }, "2026-08-17");

  assert.equal(result.projects[0].sectionCount, 1);
  assert.equal(result.projects[0].progressPercent, 33);
});

test("marca el seguimiento docente como finalizado sólo al cerrar todas sus secciones", () => {
  const complete = buildCoordinationMonitoring({
    projectRows: [project()],
    sectionRows: [section("001D", 3), section("002D", 3)],
    teacherRows: [teacher("001D"), teacher("002D")],
  }, "2026-08-17");
  assert.equal(complete.projects[0].teachers[0].status, "Finalizado");
  assert.equal(complete.summary.completedTeacherFollowUps, 1);

  const incomplete = buildCoordinationMonitoring({
    projectRows: [project()],
    sectionRows: [section("001D", 3), section("002D", 2)],
    teacherRows: [teacher("001D"), teacher("002D")],
  }, "2026-08-17");
  assert.equal(incomplete.projects[0].teachers[0].status, "En curso");
});

test("distingue atraso por fecha de término de una sección solamente pendiente", () => {
  const result = buildCoordinationMonitoring({
    projectRows: [project({ endDate: "2026-08-10" })],
    sectionRows: [section("001D", 1)],
    teacherRows: [teacher("001D")],
  }, "2026-08-17");

  assert.equal(result.projects[0].sections[0].overdue, true);
  assert.equal(result.summary.overdueSections, 1);
  assert.ok(result.alerts.some((alert) => alert.type === "OVERDUE_SECTIONS"));
});

test("señala secciones pendientes cuando Hito 2 ya está disponible", () => {
  const result = buildCoordinationMonitoring({
    projectRows: [project({ availableFrom: "2026-08-15" })],
    sectionRows: [section("001D", 1)],
    teacherRows: [teacher("001D")],
  }, "2026-08-17");

  assert.equal(result.projects[0].sections[0].status, "Hito 2 pendiente");
  assert.equal(result.projects[0].sections[0].needsAttention, true);
  assert.ok(result.alerts.some((alert) => alert.type === "PENDING_HITO_2"));
});

test("alerta cuando una sección no tiene docente asignado", () => {
  const result = buildCoordinationMonitoring({
    projectRows: [project()],
    sectionRows: [section("001D")],
    teacherRows: [],
  }, "2026-08-17");

  assert.equal(result.projects[0].sections[0].teachers.length, 0);
  assert.ok(result.alerts.some((alert) => alert.type === "UNASSIGNED_SECTIONS"));
});

test("filtra la exportación por sede, búsqueda y estado", () => {
  const report = buildCoordinationMonitoring({
    projectRows: [project(), project({ databaseId: "project-db-2", id: "VCM-2026-002", name: "Proyecto cerrado" })],
    sectionRows: [
      section("001D", 1),
      section("002D", 3, { projectId: "project-db-2", campusName: "Alameda" }),
    ],
    teacherRows: [
      teacher("001D"),
      teacher("002D", { projectId: "project-db-2", id: "teacher-2", name: "Docente Alameda" }),
    ],
  }, "2026-08-17");

  assert.deepEqual(filterMonitoringReport(report, { campus: "Alameda" }).projects.map((item) => item.id), ["VCM-2026-002"]);
  assert.deepEqual(filterMonitoringReport(report, { search: "docente alameda" }).projects.map((item) => item.id), ["VCM-2026-002"]);
  assert.deepEqual(filterMonitoringReport(report, { scope: "finished" }).projects.map((item) => item.id), ["VCM-2026-002"]);
});

test("rechaza un filtro de seguimiento desconocido", () => {
  assert.throws(
    () => normalizeMonitoringFilters({ scope: "inventado" }),
    (error) => error.status === 400 && error.code === "INVALID_MONITORING_SCOPE",
  );
});
