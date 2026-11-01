const test = require("node:test");
const assert = require("node:assert/strict");
const { buildUsersWithCampuses, normalizeAcademicIdentifier, validateAccount } = require("../src/repositories/userRepository");

test("normaliza el RUT académico del docente", () => {
  assert.equal(normalizeAcademicIdentifier(" 12.345.678-9 "), "123456789");
});

test("exige un identificador académico al crear una cuenta docente", () => {
  assert.throws(() => validateAccount({
    email: "docente@duoc.cl", name: "Docente Duoc", role: "teacher", title: "Docente",
  }), { code: "INVALID_TEACHER_ID" });
});

test("acepta una cuenta docente con RUT académico", () => {
  const account = validateAccount({
    email: "docente@duoc.cl", name: "Docente Duoc", role: "teacher", title: "Docente",
    teacherSourceId: "12.345.678-9",
  });
  assert.equal(account.teacherSourceId, "123456789");
});

test("no exige identificador académico para roles administrativos", () => {
  const account = validateAccount({
    email: "admin@duoc.cl", name: "Administración Duoc", role: "admin", title: "Administrador",
  });
  assert.equal(account.teacherSourceId, null);
});

test("muestra todas las sedes del docente, ordenadas y sin repetir por sección", () => {
  const user = { id: "teacher-1", name: "Docente Duoc", role: "teacher", active: true };
  const campus = { userId: user.id, campusId: "campus-pv", campusCode: "PV", campusName: "Plaza Vespucio" };
  const rows = [
    campus,
    { ...campus, campusId: "campus-av", campusCode: "AV", campusName: "Antonio Varas" },
    { ...campus },
  ];
  const users = buildUsersWithCampuses([user], rows);
  assert.deepEqual(users, [{
    ...user,
    campuses: [
      { id: "campus-av", code: "AV", name: "Antonio Varas" },
      { id: "campus-pv", code: "PV", name: "Plaza Vespucio" },
    ],
  }]);
  assert.equal(Object.hasOwn(user, "campuses"), false);
  assert.equal(rows.length, 3);
});

test("solo muestra las sedes vinculadas a cada usuario, incluyendo coordinadores con docencia", () => {
  const users = [
    { id: "teacher-1", role: "teacher" },
    { id: "coordinator-1", role: "coordinator", title: "Coordinador CITT" },
    { id: "director-1", role: "coordinator", title: "Director de Carrera" },
    { id: "admin-1", role: "admin" },
  ];
  const result = buildUsersWithCampuses(users, [
    { userId: "teacher-1", campusId: "campus-pv", campusCode: "PV", campusName: "Plaza Vespucio" },
    { userId: "coordinator-1", campusId: "campus-av", campusCode: "AV", campusName: "Antonio Varas" },
  ]);
  assert.deepEqual(result.map((user) => user.campuses.map((campus) => campus.name)), [
    ["Plaza Vespucio"], ["Antonio Varas"], [], [],
  ]);
  assert.deepEqual(result.map((user) => user.role), users.map((user) => user.role));
});

test("mantiene a los usuarios sin vinculación y sus estados de acceso", () => {
  const users = [
    { id: "teacher-1", role: "teacher", active: false, hasPassword: true, lastAccessAt: "2026-10-01" },
    { id: "teacher-2", role: "teacher", active: true, hasPassword: false, lastAccessAt: null },
  ];
  assert.deepEqual(buildUsersWithCampuses(users), users.map((user) => ({ ...user, campuses: [] })));
  assert.deepEqual(buildUsersWithCampuses(), []);
});

test("el listado consulta vinculaciones vigentes y devuelve las sedes junto a cada cuenta", async (context) => {
  const db = require("../src/lib/db");
  const repositoryPath = require.resolve("../src/repositories/userRepository");
  const originalModule = require.cache[repositoryPath];
  const users = [{ id: "teacher-1", role: "teacher", name: "Docente Duoc", active: true }];
  let query;
  context.mock.method(db, "getPool", async () => ({
    request: () => ({
      query: async (statement) => {
        query = statement;
        return { recordsets: [users, [
          { userId: "teacher-1", campusId: "campus-pv", campusCode: "PV", campusName: "Plaza Vespucio" },
        ]] };
      },
    }),
  }));
  context.after(() => { require.cache[repositoryPath] = originalModule; });
  delete require.cache[repositoryPath];
  const { listUsers } = require("../src/repositories/userRepository");
  assert.deepEqual(await listUsers(), [{
    ...users[0], campuses: [{ id: "campus-pv", code: "PV", name: "Plaza Vespucio" }],
  }]);
  assert.match(query, /teacher\.activo = 1/);
  assert.match(query, /assignment\.vigente = 1/);
  assert.match(query, /section\.activa = 1/);
  assert.match(query, /subject\.activa = 1/);
  assert.match(query, /campus\.activa = 1/);
  assert.match(query, /teacher\.usuario_id = usr\.usuario_id/);
  assert.match(query, /teacher\.usuario_id IS NULL AND LOWER\(teacher\.correo\) = LOWER\(usr\.correo\)/);
});
