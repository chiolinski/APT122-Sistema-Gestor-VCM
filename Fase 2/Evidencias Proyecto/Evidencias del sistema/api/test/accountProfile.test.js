const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAccountProfile } = require("../src/repositories/accountProfileRepository");

const principal = {
  id: "user-1",
  name: "María Docente",
  email: "maria@duoc.cl",
  role: "teacher",
  title: "Docente",
  initials: "MD",
  canTeach: true,
};

test("agrupa las asignaturas, secciones y sedes del perfil sin duplicados", () => {
  const common = {
    teacherId: "teacher-1",
    subjectId: "subject-1",
    subjectCode: "DSY1105",
    subjectName: "Desarrollo de software",
    schoolId: "school-1",
    schoolName: "Escuela de Informática y Telecomunicaciones",
    campusId: "campus-1",
    campusCode: "AN",
    campusName: "Antonio Varas",
    shift: "Diurna",
    period: "2026-2",
  };
  const profile = buildAccountProfile(principal, [
    { ...common, sectionId: "section-2", sectionCode: "002" },
    { ...common, sectionId: "section-1", sectionCode: "001" },
    { ...common, sectionId: "section-1", sectionCode: "001" },
  ]);

  assert.equal(profile.academic.linked, true);
  assert.deepEqual(profile.academic.totals, { campuses: 1, schools: 1, subjects: 1, sections: 2 });
  assert.equal(profile.academic.schools[0].name, "Escuela de Informática y Telecomunicaciones");
  assert.deepEqual(profile.academic.subjects[0].sections.map((section) => section.code), ["001", "002"]);
});

test("entrega un perfil válido cuando la cuenta no tiene vinculación académica", () => {
  const profile = buildAccountProfile({ ...principal, role: "admin", title: "Administrador", canTeach: false }, []);

  assert.equal(profile.academic.linked, false);
  assert.deepEqual(profile.academic.campuses, []);
  assert.deepEqual(profile.academic.schools, []);
  assert.deepEqual(profile.academic.subjects, []);
  assert.deepEqual(profile.academic.totals, { campuses: 0, schools: 0, subjects: 0, sections: 0 });
});
