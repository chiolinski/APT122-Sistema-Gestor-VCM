const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
const { validateAcademicAdjustment, validateTeacherRegistration } = require("../src/lib/academicManagement");

const id = (number) => `6f9619ff-8b86-d011-b42d-${String(number).padStart(12, "0")}`;
const S1 = id(1), S2 = id(2), T1 = id(11), T2 = id(12), A1 = id(21), A2 = id(22), P1 = id(31);
const principal = { id: id(90), role: "admin", email: "admin@example.test" };
const reason = "Cambio solicitado por dirección de carrera.";

function harness() {
  let state = {
    sections: new Map([S1, S2].map((sectionId, index) => [sectionId, { id: sectionId, code: `${index + 1}D`, subjectId: id(40),
      subjectCode: "SIY6122", subjectName: "Asignatura", campusName: index ? "Antonio Varas" : "Plaza Vespucio",
      period: "2026-2", active: true, subjectActive: true, campusActive: true, projects: [] }])),
    teachers: new Map([T1, T2].map((teacherId, index) => [teacherId, { id: teacherId, name: `Profesor ${index}`, sourceId: `6000000${index}`, active: true, accountReady: true }])),
    assignments: new Map([[`${S1}|${T1}`, true], [`${S2}|${T2}`, true]]),
    students: new Map([[A1, { id: A1, name: "Alumno Uno", rut: "123456785", active: true }], [A2, { id: A2, name: "Alumno Dos", rut: "111111111", active: true }]]),
    enrollments: [{ id: id(51), studentId: A1, subjectId: id(40), sectionId: S1, active: true }, { id: id(52), studentId: A2, subjectId: id(40), sectionId: S2, active: true }],
    teams: [], states: [], users: [], audits: [], auditAvailable: true,
  };
  const stats = { writes: 0, commits: 0, rollbacks: 0, failWrite: 0 };
  const clone = (value) => structuredClone(value);
  class Request {
    constructor() { this.parameters = {}; }
    input(name, _type, value) { this.parameters[name] = value; return this; }
    async query(statement) {
      const p = this.parameters;
      const result = (rows) => ({ recordset: clone(rows) });
      if (statement.includes("AS auditTable")) return result([{ auditTable: state.auditAvailable ? 1 : null }]);
      if (statement.includes("SELECT docente_id FROM vcm.Docente") && statement.includes("@sourceId")) return {
        recordsets: [clone([...state.teachers.values()].filter((teacher) => teacher.sourceId === p.sourceId || teacher.email === p.email)),
          clone(state.users.filter((user) => user.email === p.email))],
      };
      if (statement.includes("SELECT docente_id FROM vcm.Docente") && statement.includes("@userId")) return result([...state.teachers.values()].filter((teacher) => teacher.userId === p.userId));
      if (statement.includes("WHERE section.seccion_id = @sectionId")) {
        const section = state.sections.get(p.sectionId);
        const record = section && { ...section }; if (record) delete record.projects;
        return { recordsets: [record ? [clone(record)] : [], clone(section?.projects || [])] };
      }
      if (statement.includes("WHERE teacher.docente_id = @teacherId")) return result(state.teachers.has(p.teacherId) ? [state.teachers.get(p.teacherId)] : []);
      if (statement.includes("SELECT vigente AS active")) {
        const assignment = state.assignments.get(`${p.sectionId}|${p.teacherId}`);
        return result(assignment === undefined ? [] : [{ active: assignment }]);
      }
      if (statement.includes("SELECT COUNT(*) AS total FROM vcm.DocenteSeccion")) {
        const total = [...state.assignments].filter(([key, active]) => {
          const [sectionId, teacherId] = key.split("|");
          const teacher = state.teachers.get(teacherId);
          return sectionId === p.sectionId && teacherId !== p.teacherId && active && teacher.active && teacher.accountReady;
        }).length;
        return result([{ total }]);
      }
      if (statement.includes("FROM vcm.Alumno WITH")) return result([...state.students.values()].filter((student) => student.id === p.studentId || (p.rut && student.rut === p.rut)));
      if (statement.includes("FROM vcm.Matricula WITH")) return result(state.enrollments.filter((enrollment) => enrollment.studentId === p.studentId && enrollment.subjectId === p.subjectId));
      if (statement.includes("FROM vcm.EquipoAlumno membership WITH")) return {
        recordsets: [clone(state.teams.filter((team) => team.studentId === p.studentId && [p.sourceId, p.targetId].includes(team.sectionId))),
          clone(state.states.filter((entry) => entry.studentId === p.studentId && [p.sourceId, p.targetId].includes(entry.sectionId)))],
      };
      stats.writes += 1;
      if (stats.failWrite === stats.writes) throw new Error("Fallo simulado de escritura");
      if (statement.includes("MERGE vcm.DocenteSeccion")) { state.assignments.set(`${p.sectionId}|${p.teacherId}`, true); return result([]); }
      if (statement.includes("UPDATE vcm.DocenteSeccion")) {
        const key = `${p.sectionId}|${p.teacherId}`, affected = state.assignments.get(key) ? 1 : 0;
        state.assignments.set(key, false); return result([{ affected }]);
      }
      if (statement.includes("UPDATE vcm.Matricula")) {
        const enrollment = state.enrollments.find((entry) => entry.id === p.enrollmentId && entry.sectionId === p.sourceId && entry.active === p.expectedActive);
        if (enrollment) Object.assign(enrollment, { sectionId: p.targetId, active: p.active });
        return result([{ affected: enrollment ? 1 : 0 }]);
      }
      if (statement.includes("INSERT INTO vcm.Matricula")) {
        state.enrollments.push({ id: id(53), studentId: p.studentId, subjectId: p.subjectId, sectionId: p.targetId, active: true }); return result([]);
      }
      if (statement.includes("INSERT INTO vcm.Alumno")) {
        state.students.set(id(23), { id: id(23), name: p.name, rut: p.rut, active: true }); return result([{ id: id(23) }]);
      }
      if (statement.includes("INSERT INTO vcm.Docente")) {
        state.teachers.set(id(13), { id: id(13), name: p.name, sourceId: p.sourceId, email: p.email, userId: p.userId, active: true });
        return result([{ id: id(13) }]);
      }
      if (statement.includes("DELETE membership")) {
        state.teams = state.teams.filter((team) => team.studentId !== p.studentId || ![p.sourceId, p.targetId].includes(team.sectionId));
        for (const entry of state.states) if (entry.studentId === p.studentId && [p.sourceId, p.targetId].includes(entry.sectionId)) entry.status = "SIN_EQUIPO";
        return result([]);
      }
      throw new Error("Consulta no prevista por el simulador");
    }
  }
  const filename = path.resolve(__dirname, "../src/repositories/academicManagementRepository.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, exports: module.exports, require: (name) => {
    if (name === "../lib/db") return { sql: { ...nativeRequire("mssql"), Request }, withTransaction: async (operation) => {
      const before = clone(state);
      try { const result = await operation({}); stats.commits += 1; return result; }
      catch (error) { state = before; stats.rollbacks += 1; throw error; }
    } };
    if (name === "../lib/audit") return { writeAudit: async (_connection, _principal, event) => state.audits.push(clone(event)) };
    return nativeRequire(name);
  } }, { filename });
  const inputFor = (action, extra = {}) => validateAcademicAdjustment({ action, sectionId: S1, reason, ...extra });
  const preview = (input) => module.exports.executeAcademicAdjustment(input, principal, true);
  const apply = (input, plan) => module.exports.executeAcademicAdjustment({ ...input, confirmationCode: plan.confirmationCode, previewVersion: plan.version }, principal);
  const register = (payload) => module.exports.registerManagementTeacher(validateTeacherRegistration(payload), principal);
  return { get state() { return state; }, stats, inputFor, preview, apply, register };
}

test("la vista previa no escribe ni audita y el reemplazo conserva otras asignaciones", async () => {
  const fixture = harness();
  const input = fixture.inputFor("TEACHER_REPLACE", { previousTeacherId: T1, teacherId: T2 });
  const plan = await fixture.preview(input);
  assert.equal(fixture.stats.writes, 0); assert.equal(fixture.state.audits.length, 0);
  assert.equal(plan.changes.length, 2);
  await fixture.apply(input, plan);
  assert.equal(fixture.state.assignments.get(`${S1}|${T1}`), false);
  assert.equal(fixture.state.assignments.get(`${S1}|${T2}`), true);
  assert.equal(fixture.state.assignments.get(`${S2}|${T2}`), true);
  assert.equal(fixture.state.teachers.get(T1).active, true);
  assert.equal(fixture.state.audits[0].data.reason, reason);
});

test("intercambia profesores de forma atómica y no modifica sus cuentas", async () => {
  const fixture = harness();
  const beforeTeachers = structuredClone(fixture.state.teachers);
  const input = fixture.inputFor("TEACHER_SWAP", { teacherId: T1, otherTeacherId: T2, targetSectionId: S2 });
  await fixture.apply(input, await fixture.preview(input));
  assert.equal(fixture.state.assignments.get(`${S1}|${T1}`), false);
  assert.equal(fixture.state.assignments.get(`${S2}|${T2}`), false);
  assert.equal(fixture.state.assignments.get(`${S2}|${T1}`), true);
  assert.equal(fixture.state.assignments.get(`${S1}|${T2}`), true);
  assert.deepEqual(fixture.state.teachers, beforeTeachers);
});

test("un fallo en mitad del intercambio revierte todas las escrituras", async () => {
  const fixture = harness();
  const before = structuredClone(fixture.state.assignments);
  const input = fixture.inputFor("TEACHER_SWAP", { teacherId: T1, otherTeacherId: T2, targetSectionId: S2 });
  const plan = await fixture.preview(input);
  fixture.stats.failWrite = 3;
  await assert.rejects(fixture.apply(input, plan), /Fallo simulado/);
  assert.deepEqual(fixture.state.assignments, before); assert.equal(fixture.state.audits.length, 0);
  assert.equal(fixture.stats.rollbacks, 1);
});

test("rechaza confirmaciones antiguas o códigos incorrectos sin escribir", async () => {
  const fixture = harness();
  const input = fixture.inputFor("TEACHER_REPLACE", { previousTeacherId: T1, teacherId: T2 });
  const plan = await fixture.preview(input);
  await assert.rejects(fixture.apply(input, { ...plan, confirmationCode: "OTRA" }), { code: "WRONG_SECTION_CONFIRMATION" });
  fixture.state.teachers.get(T2).name = "Nombre actualizado";
  await assert.rejects(fixture.apply(input, plan), { code: "ADJUSTMENT_PREVIEW_STALE" });
  assert.equal(fixture.stats.writes, 0);
});

test("protege el último profesor de un proyecto y las secciones cerradas", async () => {
  const fixture = harness();
  fixture.state.sections.get(S1).projects.push({ id: P1, code: "P1", status: "EN_EJECUCION" });
  await assert.rejects(fixture.preview(fixture.inputFor("TEACHER_REMOVE", { teacherId: T1 })), { code: "LAST_PROJECT_TEACHER" });
  fixture.state.sections.get(S1).projects[0].closingStatus = "COMPLETADO";
  await assert.rejects(fixture.preview(fixture.inputFor("STUDENT_MOVE", { studentId: A1, targetSectionId: S2 })), { code: "SECTION_ADJUSTMENT_LOCKED" });
  assert.equal(fixture.stats.writes, 0);
});

test("traslada la matrícula y registra las vinculaciones a equipos anteriores sin mover avances", async () => {
  const fixture = harness();
  fixture.state.teams.push({ studentId: A1, sectionId: S1, projectId: P1, teamId: id(70), teamName: "Equipo 1" });
  fixture.state.states.push({ studentId: A1, sectionId: S1, projectId: P1, status: "ASIGNADO" });
  const input = fixture.inputFor("STUDENT_MOVE", { studentId: A1, targetSectionId: S2 });
  const plan = await fixture.preview(input);
  assert.match(plan.warnings.join(" "), /1 vinculación/);
  await fixture.apply(input, plan);
  assert.equal(fixture.state.enrollments.find((entry) => entry.studentId === A1).sectionId, S2);
  assert.equal(fixture.state.teams.length, 0);
  const before = fixture.state.audits[0].data.before.students[0];
  assert.equal(before.activity.teams[0].teamName, "Equipo 1");
  assert.equal(before.activity.states[0].status, "ASIGNADO");
  assert.equal(before.enrollment.sectionId, S1);
});

test("intercambia alumnos sin duplicar matrículas", async () => {
  const fixture = harness();
  const input = fixture.inputFor("STUDENT_SWAP", { studentId: A1, otherStudentId: A2, targetSectionId: S2 });
  await fixture.apply(input, await fixture.preview(input));
  assert.equal(fixture.state.enrollments.length, 2);
  assert.equal(fixture.state.enrollments.find((entry) => entry.studentId === A1).sectionId, S2);
  assert.equal(fixture.state.enrollments.find((entry) => entry.studentId === A2).sectionId, S1);
});

test("el retiro desactiva únicamente la matrícula y no borra al alumno", async () => {
  const fixture = harness();
  const input = fixture.inputFor("STUDENT_REMOVE", { studentId: A1 });
  await fixture.apply(input, await fixture.preview(input));
  assert.equal(fixture.state.enrollments.find((entry) => entry.studentId === A1).active, false);
  assert.equal(fixture.state.students.get(A1).active, true);
});

test("el alta no duplica ni renombra alumnos existentes y exige auditoría", async () => {
  const fixture = harness();
  await assert.rejects(fixture.preview(fixture.inputFor("STUDENT_ADD", { name: "Otro Nombre", rut: "12345678-5" })), { code: "STUDENT_NAME_CONFLICT" });
  await assert.rejects(fixture.preview(fixture.inputFor("STUDENT_ENROLL", { studentId: A1 })), { code: "STUDENT_ALREADY_ENROLLED" });
  fixture.state.auditAvailable = false;
  await assert.rejects(fixture.preview(fixture.inputFor("TEACHER_REPLACE", { previousTeacherId: T1, teacherId: T2 })), { code: "AUDIT_REQUIRED" });
  assert.equal(fixture.stats.writes, 0);
});

test("reactiva una matrícula inactiva sin duplicarla y bloquea mezclar períodos", async () => {
  const fixture = harness();
  fixture.state.enrollments[0].active = false;
  const input = fixture.inputFor("STUDENT_ENROLL", { studentId: A1 });
  await fixture.apply(input, await fixture.preview(input));
  assert.equal(fixture.state.enrollments.length, 2);
  assert.equal(fixture.state.enrollments[0].active, true);
  fixture.state.sections.get(S2).period = "2027-1";
  await assert.rejects(fixture.preview(fixture.inputFor("STUDENT_MOVE", { studentId: A1, targetSectionId: S2 })), { code: "INCOMPATIBLE_STUDENT_SECTIONS" });
});

test("crea un alumno nuevo con RUT válido y su matrícula, sin inventar equipos", async () => {
  const fixture = harness();
  const input = fixture.inputFor("STUDENT_ADD", { name: "Alumno Nuevo", rut: "20.000.000-5" });
  await fixture.apply(input, await fixture.preview(input));
  assert.equal(fixture.state.students.get(id(23)).rut, "200000005");
  assert.equal(fixture.state.enrollments.find((entry) => entry.studentId === id(23)).sectionId, S1);
  assert.equal(fixture.state.teams.length, 0);
  assert.equal(fixture.state.audits.length, 1);
});

test("matricula en otra asignatura sin alterar la matrícula vigente anterior", async () => {
  const fixture = harness();
  fixture.state.sections.get(S1).subjectId = id(41);
  const input = fixture.inputFor("STUDENT_ENROLL", { studentId: A2 });
  await fixture.apply(input, await fixture.preview(input));
  const enrollments = fixture.state.enrollments.filter((entry) => entry.studentId === A2);
  assert.equal(enrollments.length, 2);
  assert.equal(enrollments.find((entry) => entry.subjectId === id(40)).sectionId, S2);
  assert.equal(enrollments.find((entry) => entry.subjectId === id(41)).sectionId, S1);
});

test("un intercambio de alumnos fallido conserva ambas matrículas y sus equipos", async () => {
  const fixture = harness();
  fixture.state.teams.push({ studentId: A1, sectionId: S1, teamName: "Equipo 1" });
  const before = structuredClone(fixture.state);
  const input = fixture.inputFor("STUDENT_SWAP", { studentId: A1, otherStudentId: A2, targetSectionId: S2 });
  const plan = await fixture.preview(input);
  fixture.stats.failWrite = 3;
  await assert.rejects(fixture.apply(input, plan), /Fallo simulado/);
  assert.deepEqual(fixture.state.enrollments, before.enrollments);
  assert.deepEqual(fixture.state.teams, before.teams);
  assert.equal(fixture.state.audits.length, 0);
});

test("el registro manual de un profesor no crea ni restablece cuentas de acceso", async () => {
  const fixture = harness();
  const result = await fixture.register({ name: "Profesor Nuevo", sourceId: "60027060", email: "nuevo@example.test", reason, confirmed: true });
  assert.equal(result.needsAccount, true);
  assert.equal(fixture.state.users.length, 0);
  assert.equal(fixture.state.teachers.get(id(13)).sourceId, "60027060");
  assert.equal(fixture.state.audits[0].action, "ACADEMIC_TEACHER_CREATED");
  await assert.rejects(fixture.register({ name: "Otro Profesor", sourceId: "60027060", email: "otro@example.test", reason, confirmed: true }), { code: "TEACHER_ALREADY_EXISTS" });
});
