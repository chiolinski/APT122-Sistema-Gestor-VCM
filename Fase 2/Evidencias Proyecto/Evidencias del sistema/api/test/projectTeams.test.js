const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertTeacherProjectAccess,
  getTeamSectionId,
  validateRosterAssignments,
  validateStudentAssignmentUpdate,
  validateTeamAssignmentInput,
  validateTeamInput,
} = require("../src/lib/projectTeams");

const teacher = { id: "teacher-1", role: "teacher", canTeach: true };
const teachingCoordinator = { id: "coordinator-1", role: "coordinator", canTeach: true };

test("permite modificar el proyecto al docente asignado", () => {
  const project = { id: "project-1", teacherAssigned: true };
  assert.equal(assertTeacherProjectAccess(teacher, project), project);
});

test("permite modificar el proyecto al coordinador con docencia asignada", () => {
  const project = { id: "project-1", teacherAssigned: true };
  assert.equal(assertTeacherProjectAccess(teachingCoordinator, project), project);
});

test("rechaza al docente que no está asignado al proyecto", () => {
  assert.throws(
    () => assertTeacherProjectAccess(teacher, { id: "project-1", teacherAssigned: false }),
    (error) => error.status === 403 && error.code === "PROJECT_ACCESS_DENIED",
  );
});

test("rechaza al coordinador sin carga académica aunque el proyecto tenga docentes", () => {
  assert.throws(
    () => assertTeacherProjectAccess({ id: "coordinator-1", role: "coordinator", canTeach: false }, { id: "project-1", teacherAssigned: true }),
    (error) => error.status === 403 && error.code === "PROJECT_ACCESS_DENIED",
  );
});

test("rechaza al coordinador docente en un proyecto de otra sección", () => {
  assert.throws(
    () => assertTeacherProjectAccess(teachingCoordinator, { id: "project-1", teacherAssigned: false }),
    (error) => error.status === 403 && error.code === "PROJECT_ACCESS_DENIED",
  );
});

test("rechaza otros roles aunque el proyecto tenga una asignación docente", () => {
  assert.throws(
    () => assertTeacherProjectAccess({ id: "admin-1", role: "admin", canTeach: true }, { id: "project-1", teacherAssigned: true }),
    (error) => error.status === 403 && error.code === "PROJECT_ACCESS_DENIED",
  );
});

test("acepta equipos que cubren exactamente la nómina asignada", () => {
  const roster = [
    { id: "student-1", sectionId: "section-1" },
    { id: "student-2", sectionId: "section-1" },
  ];
  const teams = validateTeamInput({ teams: [
    { sectionId: "section-1", name: "Equipo 1", studentIds: ["student-1", "student-2"] },
  ] });
  assert.equal(validateRosterAssignments(teams, roster), teams);
});

test("permite crear hasta veinte equipos en una sección", () => {
  const teams = validateTeamInput({ teams: Array.from({ length: 20 }, (_, index) => ({
    sectionId: "section-1",
    name: `Equipo ${index + 1}`,
    studentIds: [`student-${index + 1}`],
  })) });
  assert.equal(teams.length, 20);
});

test("rechaza más de veinte equipos en una sección", () => {
  assert.throws(
    () => validateTeamInput({ teams: Array.from({ length: 21 }, (_, index) => ({
      sectionId: "section-1",
      name: `Equipo ${index + 1}`,
      studentIds: [`student-${index + 1}`],
    })) }),
    (error) => error.status === 400 && error.code === "INVALID_TEAMS",
  );
});

test("impide asignar estudiantes de otra sección o proyecto", () => {
  const roster = [{ id: "student-1", sectionId: "section-1" }];
  const teams = validateTeamInput({ teams: [
    { sectionId: "section-2", name: "Equipo 1", studentIds: ["student-1"] },
  ] });
  assert.throws(
    () => validateRosterAssignments(teams, roster),
    (error) => error.status === 403 && error.code === "STUDENT_OUTSIDE_ASSIGNMENT",
  );
});

test("exige que todos los estudiantes queden en un equipo", () => {
  const roster = [
    { id: "student-1", sectionId: "section-1" },
    { id: "student-2", sectionId: "section-1" },
  ];
  const teams = validateTeamInput({ teams: [
    { sectionId: "section-1", name: "Equipo 1", studentIds: ["student-1"] },
  ] });
  assert.throws(
    () => validateRosterAssignments(teams, roster),
    (error) => error.status === 400 && error.code === "INCOMPLETE_TEAM_ASSIGNMENT",
  );
});

test("permite completar la nómina con estudiantes sin equipo o desertores", () => {
  const assignment = validateTeamAssignmentInput({
    teams: [],
    students: [
      { studentId: "student-1", sectionId: "section-1", status: "SIN_EQUIPO" },
      { studentId: "student-2", sectionId: "section-1", status: "DESERTOR" },
    ],
  });
  const roster = [
    { id: "student-1", sectionId: "section-1" },
    { id: "student-2", sectionId: "section-1" },
  ];
  assert.equal(assignment.sectionId, "section-1");
  assert.doesNotThrow(() => validateRosterAssignments(assignment.teams, roster, assignment.studentStates));
});

test("exige coherencia entre el estado asignado y la pertenencia a un equipo", () => {
  const roster = [{ id: "student-1", sectionId: "section-1" }];
  assert.throws(
    () => validateRosterAssignments([], roster, [
      { studentId: "student-1", sectionId: "section-1", status: "ASIGNADO" },
    ]),
    (error) => error.status === 400 && error.code === "INCONSISTENT_STUDENT_STATUS",
  );
});

test("normaliza cambios posteriores de equipo y estados sin equipo", () => {
  assert.deepEqual(validateStudentAssignmentUpdate({
    sectionId: "section-1", status: "asignado", teamNumber: "20",
  }), { sectionId: "section-1", status: "ASIGNADO", teamNumber: 20 });
  assert.deepEqual(validateStudentAssignmentUpdate({
    sectionId: "section-1", status: "desertor",
  }), { sectionId: "section-1", status: "DESERTOR", teamNumber: null });
});

test("rechaza equipos en estados sin equipo o fuera del rango permitido", () => {
  assert.throws(
    () => validateStudentAssignmentUpdate({ sectionId: "section-1", status: "SIN_EQUIPO", teamNumber: 1 }),
    (error) => error.status === 400 && error.code === "TEAM_NOT_ALLOWED",
  );
  assert.throws(
    () => validateStudentAssignmentUpdate({ sectionId: "section-1", status: "ASIGNADO", teamNumber: 21 }),
    (error) => error.status === 400 && error.code === "TEAM_REQUIRED",
  );
});

test("identifica la única sección incluida en una carga de equipos", () => {
  assert.equal(getTeamSectionId([
    { sectionId: "section-1", name: "Equipo 1", studentIds: ["student-1"] },
    { sectionId: "section-1", name: "Equipo 2", studentIds: ["student-2"] },
  ]), "section-1");
});

test("impide guardar dos secciones mezcladas en la misma operación", () => {
  assert.throws(
    () => getTeamSectionId([
      { sectionId: "section-1", name: "Equipo 1", studentIds: ["student-1"] },
      { sectionId: "section-2", name: "Equipo 1", studentIds: ["student-2"] },
    ]),
    (error) => error.status === 400 && error.code === "TEAMS_MUST_SHARE_SECTION",
  );
});
