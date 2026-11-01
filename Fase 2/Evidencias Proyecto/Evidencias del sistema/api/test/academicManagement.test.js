const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION_LABELS, validateAcademicAdjustment, validateTeacherRegistration, assertCompatibleStudentSections } = require("../src/lib/academicManagement");
const { assertEditableSection, assertTeacherReady } = require("../src/repositories/academicManagementRepository");

const ids = Array.from({ length: 5 }, (_, index) => `6f9619ff-8b86-d011-b42d-00c04fc964f${index}`);
const base = { sectionId: ids[0], teacherId: ids[1], previousTeacherId: ids[2], studentId: ids[1],
  targetSectionId: ids[3], otherTeacherId: ids[4], otherStudentId: ids[4],
  reason: "Cambio solicitado por la dirección.", name: "María Pérez", rut: "12.345.678-5" };

test("valida todas las operaciones con identificadores compatibles con SQL Server", () => {
  for (const action of Object.keys(ACTION_LABELS)) {
    const input = validateAcademicAdjustment({ ...base, action });
    assert.equal(input.action, action);
    assert.equal(input.sectionId, ids[0]);
    assert.equal(input.reason, base.reason);
    assert.equal(Object.hasOwn(input, "confirmed"), false);
  }
  assert.equal(validateAcademicAdjustment({ ...base, action: "STUDENT_ADD" }).rut, "123456785");
});

test("rechaza acciones desconocidas, identificadores inválidos y motivos insuficientes", () => {
  for (const payload of [
    { ...base, action: "BORRAR_TODO" }, { ...base, action: "__proto__" },
    { ...base, action: "TEACHER_ASSIGN", teacherId: "invalido" },
    { ...base, action: "STUDENT_MOVE", targetSectionId: "invalido" },
    { ...base, action: "STUDENT_REMOVE", reason: "corto" },
    { ...base, action: "STUDENT_REMOVE", reason: "x".repeat(501) },
  ]) assert.throws(() => validateAcademicAdjustment(payload), (error) => error.status === 400);
});

test("no permite reemplazar una persona por sí misma ni intercambiar la misma sección", () => {
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "TEACHER_REPLACE", previousTeacherId: base.teacherId }), { code: "SAME_TEACHER" });
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "TEACHER_SWAP", otherTeacherId: base.teacherId }), { code: "SAME_TEACHER" });
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "STUDENT_SWAP", otherStudentId: base.studentId }), { code: "SAME_STUDENT" });
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "STUDENT_MOVE", targetSectionId: base.sectionId.toUpperCase() }), { code: "SAME_SECTION" });
});

test("exige confirmación explícita, código y una versión de la vista previa al aplicar", () => {
  const payload = { ...base, action: "TEACHER_ASSIGN" };
  assert.throws(() => validateAcademicAdjustment(payload, true), { code: "ADJUSTMENT_CONFIRMATION_REQUIRED" });
  assert.throws(() => validateAcademicAdjustment({ ...payload, confirmed: "true", confirmationCode: "003D" }, true), { code: "ADJUSTMENT_CONFIRMATION_REQUIRED" });
  assert.throws(() => validateAcademicAdjustment({ ...payload, confirmed: true, confirmationCode: "003D" }, true), { code: "ADJUSTMENT_PREVIEW_REQUIRED" });
  const input = validateAcademicAdjustment({ ...payload, confirmed: true, confirmationCode: " 003D ", previewVersion: "a".repeat(64) }, true);
  assert.equal(input.confirmationCode, "003D");
  assert.equal(input.previewVersion.length, 64);
});

test("el alta manual mantiene la validación de RUT y de nombre", () => {
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "STUDENT_ADD", rut: "00000000-0" }), { code: "INVALID_STUDENT_RUT" });
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "STUDENT_ADD", rut: "12.345.678-0" }), { code: "INVALID_STUDENT_RUT" });
  assert.throws(() => validateAcademicAdjustment({ ...base, action: "STUDENT_ADD", name: "x" }), { code: "INVALID_STUDENT_NAME" });
});

test("permite traslado entre sedes pero exige misma asignatura y período", () => {
  const section = { subjectId: ids[0], period: "2026-2", campus: "Plaza Vespucio" };
  assert.doesNotThrow(() => assertCompatibleStudentSections(section, { ...section, campus: "Antonio Varas" }));
  assert.throws(() => assertCompatibleStudentSections(section, { ...section, subjectId: ids[1] }), { code: "INCOMPATIBLE_STUDENT_SECTIONS" });
  assert.throws(() => assertCompatibleStudentSections(section, { ...section, period: "2026-1" }), { code: "INCOMPATIBLE_STUDENT_SECTIONS" });
});

test("protege secciones inactivas o cerradas, sin impedir ajustes en secciones abiertas", () => {
  const section = { active: true, subjectActive: true, campusActive: true, projects: [] };
  assert.doesNotThrow(() => assertEditableSection(section));
  for (const flag of ["active", "subjectActive", "campusActive"]) {
    assert.throws(() => assertEditableSection({ ...section, [flag]: false }), { code: "INACTIVE_SECTION" });
  }
  for (const project of [
    { code: "P1", status: "FINALIZADO" }, { code: "P2", status: "CANCELADO" },
    { code: "P3", status: "EN_EJECUCION", closingStatus: "COMPLETADO" },
  ]) assert.throws(() => assertEditableSection({ ...section, projects: [project] }), { code: "SECTION_ADJUSTMENT_LOCKED" });
});

test("no asigna profesores sin cuenta habilitada ni crea contraseñas automáticamente", () => {
  assert.doesNotThrow(() => assertTeacherReady({ name: "Profesor", active: true, accountReady: true }));
  assert.throws(() => assertTeacherReady({ name: "Profesor", active: true, accountReady: false }), { code: "TEACHER_ACCOUNT_REQUIRED" });
  assert.throws(() => assertTeacherReady({ name: "Profesor", active: false, accountReady: true }), { code: "TEACHER_ACCOUNT_REQUIRED" });
  const registration = validateTeacherRegistration({ name: "Andrés Altamirano", sourceId: "60.027.060", email: " AN.ALTAMIRANOT@PROFESOR.DUOC.CL ", reason: base.reason, confirmed: true, password: "NoSeUsa2026" });
  assert.equal(registration.sourceId, "60027060");
  assert.equal(registration.email, "an.altamiranot@profesor.duoc.cl");
  assert.equal(Object.hasOwn(registration, "password"), false);
  assert.throws(() => validateTeacherRegistration({ name: "Profesor", sourceId: "60027060", email: "correo", reason: base.reason, confirmed: true }), { code: "INVALID_TEACHER_DATA" });
});
