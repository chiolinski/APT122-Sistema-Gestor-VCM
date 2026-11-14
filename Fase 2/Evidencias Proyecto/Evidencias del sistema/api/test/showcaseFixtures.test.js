const test = require("node:test");
const assert = require("node:assert/strict");
const { buildShowcase, buildAssignment, SCENARIOS } = require("../scripts/lib/showcase-fixtures");
const { validateAcademicRows } = require("../src/lib/academicRows");
const { validatePartnerInput, validateProjectInput } = require("../src/lib/operationalData");
const { isValidRut } = require("../src/lib/partnerRows");
const { validateAccount } = require("../src/repositories/userRepository");
const { validateTeamAssignmentInput, validateRosterAssignments } = require("../src/lib/projectTeams");

test("la demostración contiene 250 cuentas internas válidas y correos de prueba", () => {
  const { accounts } = buildShowcase();
  assert.equal(accounts.length, 250);
  assert.equal(new Set(accounts.map((a) => a.email)).size, 250);
  for (const account of accounts) {
    assert.match(account.email, /^demo\..+@example\.test$/);
    assert.doesNotThrow(() => validateAccount(account));
  }
  assert.deepEqual(Object.fromEntries(["admin", "coordinacion", "direccion", "docente"].map((category) =>
    [category, accounts.filter((a) => a.category === category).length])), { admin: 5, coordinacion: 20, direccion: 25, docente: 200 });
});

test("la carga de 2.880 alumnos pasa el validador real sin duplicar matrículas ni RUT", () => {
  const plan = buildShowcase();
  const parsed = validateAcademicRows(plan.academicRows);
  assert.equal(parsed.canApply, true);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.summary.students, 2880);
  assert.equal(parsed.summary.sections, 240);
  assert.equal(parsed.summary.teachers, 210);
  assert.equal(parsed.summary.campuses, 10);
  assert.equal(parsed.summary.schools, 6);
  assert.equal(parsed.summary.subjects, 16);
  assert.equal(new Set(plan.academicRows.map((r) => r.estudiante_rut)).size, 2880);
  for (const row of plan.academicRows) {
    assert.equal(isValidRut(row.estudiante_rut), true);
    assert.match(row.estudiante_correo, /@example\.test$/);
    assert.match(row.docente_correo, /@example\.test$/);
  }
});

test("los 80 proyectos cubren 16 escenarios y vinculan secciones, creadores y socios válidos", () => {
  const plan = buildShowcase();
  assert.equal(plan.projects.length, 80);
  assert.equal(plan.partners.length, 40);
  assert.equal(new Set(plan.partners.map((p) => p.taxId)).size, 40);
  for (const partner of plan.partners) assert.doesNotThrow(() => validatePartnerInput(partner));
  for (const scenario of SCENARIOS) assert.equal(plan.projects.filter((p) => p.scenario === scenario.key).length, 5);
  const assignedTeachers = new Set();
  for (const project of plan.projects) {
    assert.equal(project.sections.length, 3);
    assert.equal(new Set(project.sections.map((s) => s.campusCode)).size, 3);
    assert.ok(plan.partners.some((p) => p.contactEmail === project.partnerEmail));
    assert.ok(plan.accounts.some((a) => a.email === project.creatorEmail && a.role === "COORDINATOR"));
    assert.doesNotThrow(() => validateProjectInput({ ...project, partnerId: "fixture-partner", subjectId: project.subjectCode,
      campusIds: project.sections.map((s) => s.campusCode), sectionIds: project.sections.map((s) => s.code) }));
    for (const section of project.sections) {
      assignedTeachers.add(section.teacherEmail);
      assert.equal(section.students.length, 12);
      const rows = plan.academicRows.filter((r) => r.seccion_codigo === section.code);
      assert.ok(rows.every((r) => r.asignatura_codigo === project.subjectCode && r.sede_codigo === section.campusCode));
    }
  }
  assert.equal(assignedTeachers.size, 210);
});

test("los equipos cubren diez alumnos y conservan los estados sin equipo y desertor", () => {
  const sectionId = "11111111-1111-1111-1111-111111111111";
  const roster = Array.from({ length: 12 }, (_, i) => ({ id: `student-${i}`, email: `demo.estudiante${String(i).padStart(4, "0")}@example.test`, sectionId }));
  const assignment = buildAssignment(roster, sectionId);
  const validated = validateTeamAssignmentInput(assignment);
  assert.doesNotThrow(() => validateRosterAssignments(validated.teams, roster, validated.studentStates));
  assert.equal(assignment.teams.length, 3);
  assert.equal(assignment.teams.flatMap((team) => team.studentIds).length, 10);
  assert.equal(assignment.students.filter((s) => s.status === "SIN_EQUIPO").length, 1);
  assert.equal(assignment.students.filter((s) => s.status === "DESERTOR").length, 1);
  assert.throws(() => buildAssignment(roster.slice(0, 11), sectionId), /doce/);
});

test("la receta es determinista y permanece separada de los fixtures iniciales", () => {
  const plan = buildShowcase();
  assert.deepEqual(plan, buildShowcase());
  const initialAccounts = require("../../fixtures/accounts-local.json");
  const initialRows = require("../../fixtures/academic-local.json");
  assert.ok(plan.accounts.every((a) => !initialAccounts.some((initial) => initial.email === a.email)));
  assert.ok(plan.academicRows.every((row) => !initialRows.some((initial) => initial.estudiante_rut === row.estudiante_rut
    || initial.asignatura_codigo === row.asignatura_codigo || initial.sede_codigo === row.sede_codigo)));
});
