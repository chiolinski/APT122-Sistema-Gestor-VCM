const test = require("node:test");
const assert = require("node:assert/strict");
const { toProfile } = require("../src/repositories/authRepository");

function user(overrides = {}) {
  return {
    id: "user-1",
    email: "coordinador@duoc.cl",
    name: "Coordinador Docente",
    role: "COORDINATOR",
    title: "Coordinador CITT",
    canTeach: 0,
    ...overrides,
  };
}

test("mantiene el rol coordinador y habilita la capacidad docente por separado", () => {
  const profile = toProfile(user({ canTeach: 1 }));
  assert.equal(profile.role, "coordinator");
  assert.equal(profile.canTeach, true);
});

test("no habilita la faceta docente cuando no existe una asignación vigente", () => {
  const profile = toProfile(user());
  assert.equal(profile.role, "coordinator");
  assert.equal(profile.canTeach, false);
});

test("nunca concede la capacidad docente a un rol administrativo", () => {
  const profile = toProfile(user({ role: "ADMIN", title: "Administrador", canTeach: 1 }));
  assert.equal(profile.role, "admin");
  assert.equal(profile.canTeach, false);
});
