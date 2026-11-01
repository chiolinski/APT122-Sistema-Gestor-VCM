const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertControlAccess,
  buildDataQualityReport,
  buildNotifications,
  normalizeControlFilters,
} = require("../src/lib/controlCenter");

test("permite el centro de control solo a administración y coordinación", () => {
  assert.equal(assertControlAccess({ role: "admin" }).role, "admin");
  assert.equal(assertControlAccess({ role: "coordinator" }).role, "coordinator");
  assert.throws(() => assertControlAccess({ role: "teacher" }), (error) => error.status === 403 && error.code === "CONTROL_ACCESS_DENIED");
});

test("normaliza filtros y limita paginación de auditoría", () => {
  assert.deepEqual(normalizeControlFilters({ query: "  proyecto ", action: "PROJECT_CREATED", page: "2", pageSize: "500" }), {
    query: "proyecto",
    action: "PROJECT_CREATED",
    entity: "all",
    severity: "all",
    page: 2,
    pageSize: 100,
  });
  assert.throws(() => normalizeControlFilters({ severity: "critical" }), (error) => error.status === 400);
});

test("resume calidad de datos por prioridad y ámbito", () => {
  const report = buildDataQualityReport({
    unlinkedTeachers: [{ id: "t1", name: "Docente Uno", email: "uno@duoc.cl", sections: 2 }],
    sectionsWithoutStudents: [{ id: "s1", projectCode: "VCM-2026-001", subjectCode: "DSY1105", sectionCode: "001D", campusName: "CONCEPCIÓN" }],
    incompleteTeams: [{ id: "s2", sectionId: "s2", projectCode: "VCM-2026-002", sectionCode: "002D", students: 20, assignedStudents: 15, teams: 4 }],
    teacherAccountsWithoutAssignments: [{ id: "u1", name: "Docente Dos", email: "dos@duoc.cl" }],
  });
  assert.equal(report.status, "attention");
  assert.deepEqual(report.summary, { total: 4, high: 1, medium: 2, info: 1, teachers: 2, sections: 2 });
  assert.equal(report.issues[0].type, "UNLINKED_TEACHER");
});

test("genera notificaciones operativas y conserva lectura por clave", () => {
  const result = buildNotifications({
    coordinationAlerts: [{ id: "p1:pending", priority: "medium", title: "Hito pendiente", message: "Falta una sección." }],
    qualityReport: { summary: { total: 2, high: 1, medium: 1, info: 0 } },
    teachingRows: [{
      projectCode: "VCM-2026-001", projectName: "Proyecto", sectionId: "s1", sectionCode: "001D",
      campusName: "CONCEPCIÓN", hito1Status: "COMPLETADO", hito2Status: "PENDIENTE",
      hito3Status: "PENDIENTE", hito2Available: true, availableFrom: "2026-08-17",
    }],
    readKeys: ["coordination:p1:pending"],
  });
  assert.equal(result.records.length, 3);
  assert.equal(result.unreadCount, 2);
  assert.equal(result.records.find((record) => record.key === "coordination:p1:pending").read, true);
  assert.match(result.records.find((record) => record.type === "teaching").actionUrl, /section=s1/);
});
