const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCoordinationMonitoring } = require("../src/lib/coordinationMonitoring");

const project = (databaseId, status = "EN_EJECUCION", partnerId = "partner-1") => ({ databaseId, id: databaseId, name: databaseId, status, partnerId, subjectCode: "DEMO", subjectName: "Asignatura ficticia" });
const section = (projectId, id, completed = 0, extra = {}) => ({ projectId, id, code: id, campusName: "Sede ficticia",
  hito1Status: completed >= 1 ? "COMPLETADO" : "PENDIENTE", hito2Status: completed >= 2 ? "COMPLETADO" : "PENDIENTE", hito3Status: completed >= 3 ? "COMPLETADO" : "PENDIENTE", ...extra });
const student = (projectId, sectionId, studentId, teamId = "team-1", assignmentStatus = "ASIGNADO") => ({ projectId, sectionId, studentId, teamId, assignmentStatus });
const review = (projectId, sectionId, reviewId, rating, extra = {}) => ({ projectId, sectionId, reviewId, partnerId: "partner-1", teamId: "team-1", rating, ...extra });
const build = (input, filters) => buildCoordinationMonitoring(input, "2026-11-05", filters).indicators;

test("cuenta personas y equipos únicos sin sumar duplicados de secciones o proyectos", () => {
  const data = build({ projectRows: [project("p1"), project("p2")], sectionRows: [section("p1", "s1", 1), section("p2", "s2", 1)],
    teacherRows: [{ projectId: "p1", sectionId: "s1", id: "TEACHER", name: "Docente ficticio" }, { projectId: "p2", sectionId: "s2", id: "teacher", name: "Docente ficticio" }],
    studentRows: [student("p1", "s1", "STUDENT"), student("p1", "s1", "STUDENT"), student("p2", "s2", "student"),
      student("p1", "s1", "s2", null, "SIN_EQUIPO"), student("p1", "s1", "s3", "team-2", "DESERTOR"), student("p1", "otra", "ajeno")],
    reviewRows: [review("p1", "s1", "r1", 4), review("p1", "s1", "r1", 4), review("p2", "s2", "r2", 2)] });
  assert.equal(data.enrolledStudents, 3);
  assert.equal(data.participatingStudents, 1);
  assert.equal(data.studentParticipationPercent, 33.3);
  assert.equal(data.formedTeams, 1);
  assert.equal(data.participatingTeachers, 1);
  assert.equal(data.linkedPartners, 1);
  assert.equal(data.respondingPartners, 1);
  assert.equal(data.answeredReviewCount, 2);
  assert.equal(data.ratingCount, 2);
});

test("el hito global exige todas las secciones y una reapertura elimina su finalización", () => {
  const data = build({ projectRows: [project("p1"), project("p2", "FINALIZADO"), project("p3"), project("empty")],
    sectionRows: [section("p1", "a", 3), section("p1", "b", 1), section("p2", "c", 3), section("p2", "d", 3),
      section("p3", "e", 3), section("p3", "f", 1)] });
  assert.deepEqual(data.milestones.map((m) => m.completedProjects), [3, 1, 1]);
  assert.equal(data.milestones[0].totalProjects, 4);
  assert.equal(data.milestones[0].percent, 75);
  assert.equal(data.completedSectionMilestones, 14);
  assert.equal(data.totalSectionMilestones, 18);
  assert.equal(data.sectionProgressPercent, 77.8);
  const inconsistent = build({ projectRows: [project("p1")], sectionRows: [section("p1", "a", 3)] });
  assert.equal(inconsistent.milestones[2].completedProjects, 0, "Completar secciones sin estado finalizado no finaliza el proyecto.");
});

test("cada proyecto pesa lo mismo en la valoración y no se inventan ceros para los que no tienen respuestas", () => {
  const data = build({ projectRows: [project("p1"), project("p2"), project("p3")], sectionRows: [section("p1", "a"), section("p2", "b"), section("p3", "c")],
    reviewRows: [review("p1", "a", "r1", 5), review("p1", "a", "r1", 5, { teamId: "team-2" }), review("p1", "a", "r1", 5, { teamId: "team-3" }),
      review("p2", "b", "r2", 1), review("p3", "c", "r3", null, { teamId: null, partnerId: "partner-2" })] });
  assert.equal(data.averageProjectRating, 3, "Promedio de proyectos 5 y 1; no promedio ponderado por los cuatro equipos.");
  assert.equal(data.ratedProjects, 2);
  assert.equal(data.ratingCount, 4);
  assert.equal(data.reviewCount, 3);
  assert.equal(data.partnersInvited, 2);
  assert.equal(data.respondingPartners, 1);
  assert.equal(data.partnerResponsePercent, 50);
});

test("conserva respuestas parciales y vencidas, excluye revocadas salvo evidencia de cierre y descarta valores inválidos", () => {
  const data = build({ projectRows: [project("p1")], sectionRows: [section("p1", "a")], reviewRows: [
    review("p1", "a", "partial", 3), review("p1", "a", "expired", 5, { expiresAt: "2026-10-01" }),
    review("p1", "a", "revoked", 1, { revoked: "2026-11-01", partnerId: "excluded" }),
    review("p1", "a", "closure", 4, { revoked: "2026-11-01", usedForClosure: true }),
    review("p1", "otra", "outside-section", 5), review("other", "a", "outside-project", 5),
    ...[0, 6, 2.5, "error"].map((rating, i) => review("p1", "a", "invalid", rating, { teamId: `invalid-${i}` })),
  ] });
  assert.equal(data.ratingCount, 3);
  assert.equal(data.averageProjectRating, 4);
  assert.equal(data.respondingPartners, 1);
  assert.equal(data.answeredReviewCount, 3);
});

test("excluye cancelados y recalcula los indicadores de la exportación filtrada sin filtrar secciones del proyecto", () => {
  const input = { projectRows: [project("p1"), project("p2", "FINALIZADO"), project("cancel", "CANCELADO", "cancel-partner")],
    sectionRows: [section("p1", "a", 1), section("p1", "b", 0, { campusName: "Otra sede ficticia" }), section("p2", "c", 3), section("cancel", "d", 3)],
    studentRows: [student("p1", "a", "student1"), student("p1", "b", "student2"), student("p2", "c", "student3"), student("cancel", "d", "excluded")],
    reviewRows: [review("p1", "a", "r1", 2), review("p2", "c", "r2", 5), review("cancel", "d", "r3", 1, { partnerId: "cancel-partner" })] };
  const all = build(input);
  assert.equal(all.projectCount, 2);
  assert.equal(all.participatingStudents, 3);
  assert.equal(all.averageProjectRating, 3.5);
  const filtered = build(input, { scope: "finished" });
  assert.equal(filtered.projectCount, 1);
  assert.equal(filtered.participatingStudents, 1);
  assert.equal(filtered.averageProjectRating, 5);
  const campus = build(input, { campus: "Otra sede ficticia" });
  assert.equal(campus.projectCount, 1);
  assert.equal(campus.participatingStudents, 2);
  assert.equal(campus.milestones[0].completedProjects, 0, "Seleccionar una sede no convierte un hito parcial en global.");
});

test("un portafolio vacío entrega ceros finitos y valoración sin datos", () => {
  const data = build({});
  assert.equal(data.projectCount, 0);
  assert.equal(data.averageProjectRating, null);
  assert.equal(data.studentParticipationPercent, 0);
  assert.equal(data.partnerResponsePercent, 0);
  assert.equal(data.sectionProgressPercent, 0);
  assert.ok(data.milestones.every((milestone) => milestone.completedProjects === 0 && milestone.percent === 0));
});

test("la respuesta conserva todas las sedes disponibles aun cuando los filtros no devuelven proyectos", () => {
  const result = buildCoordinationMonitoring({
    projectRows: [project("p1"), project("p2", "FINALIZADO")],
    sectionRows: [section("p1", "a", 0, { campusName: "Sede ficticia A" }), section("p2", "b", 3, { campusName: "Sede ficticia B" })],
  }, "2026-11-05", { campus: "Sede ficticia A", scope: "finished" });
  assert.equal(result.projects.length, 0);
  assert.equal(result.indicators.projectCount, 0);
  assert.equal(result.alerts.length, 0);
  assert.deepEqual(result.availableCampuses, ["Sede ficticia A", "Sede ficticia B"]);
  assert.deepEqual(result.filters, { campus: "Sede ficticia A", scope: "finished", search: "", period: "" });
});

test("integra videos, deserción, escuelas y detalle por proyecto respetando período y alcance global", () => {
  const rows = {
    projectRows: [{ ...project("p1"), schoolName: "Escuela ficticia" }, project("p2", "PLANIFICADO"), project("p3", "CANCELADO")],
    sectionRows: [section("p1", "a", 2, { periodCode: "2026-2" }), section("p1", "b", 0, { periodCode: "2026-1", campusName: "Otra sede" }),
      section("p2", "c", 0, { periodCode: "2026-2" }), section("p3", "d", 2, { periodCode: "2026-2" })],
    studentRows: [{ ...student("p1", "a", "a1"), videoDelivered: true }, { ...student("p1", "a", "a2"), videoDelivered: true },
      student("p1", "a", "a3", null, "DESERTOR"), student("p1", "b", "b1", "team-2"), student("p1", "b", "b2", null, "SIN_EQUIPO")],
    reviewRows: [review("p1", "a", "r1", 4), review("p1", "a", "r1", 5, { teamId: "team-2" })],
  };
  const report = buildCoordinationMonitoring(rows, "2026-11-05", { period: "2026-2" });
  const data = report.indicators;
  assert.deepEqual(report.availablePeriods, ["2026-2", "2026-1"]);
  assert.deepEqual(report.campusComparisons.map((row) => row.campusName), ["Sede ficticia"]);
  assert.equal(data.milestones[0].completedProjects, 0);
  assert.deepEqual(data.videoDelivery, { numerator: 1, denominator: 2, percent: 50 });
  assert.deepEqual(data.dropout, { numerator: 1, denominator: 5, percent: 20 });
  assert.deepEqual(data.projectsWithAllVideos, { numerator: 0, denominator: 1, percent: 0 });
  assert.deepEqual(data.projectsWithDropout, { numerator: 1, denominator: 1, percent: 100 });
  assert.deepEqual(data.projectsBySchool.map((row) => [row.school, row.numerator]), [["Escuela ficticia", 1], ["Sin escuela", 1]]);
  assert.equal(data.projectDetails.length, 1);
  const [detail] = data.projectDetails;
  assert.deepEqual(detail.participation, { numerator: 3, denominator: 4, percent: 75 });
  assert.equal(detail.milestones[0].percent, 50);
  assert.deepEqual(detail.partnerResponse, { numerator: 0, denominator: 1, percent: 0 });
  assert.equal(data.answeredReviewCount, 1);
  assert.equal(detail.partnerRating, null);
  assert.equal(data.averageProjectRating, 4.5);
  rows.reviewRows.push(review("p1", "b", "r2", 3, { completedByPartner: true }));
  assert.equal(build(rows).projectDetails[0].partnerRating, 4);
  assert.equal(build(rows).projectDetails[0].partnerResponse.percent, 50);
  assert.equal(build(rows, { period: "2026-2", campus: "Otra sede" }).projectCount, 0);
});

test("compara sedes con personas únicas y avance local sin convertir cierres parciales en hitos globales", () => {
  const input = {
    projectRows: [project("p1"), project("p2"), project("cancel", "CANCELADO")],
    sectionRows: [section("p1", "a", 3, { campusName: "Aurora" }), section("p1", "b", 0, { campusName: "Bosque" }),
      section("p2", "c", 1, { campusName: "Aurora" }), section("cancel", "d", 3, { campusName: "Cancelada" })],
    studentRows: [student("p1", "a", "ALUMNO"), student("p1", "a", "ALUMNO"), student("p2", "c", "alumno"),
      student("p1", "a", "sin-equipo", null, "SIN_EQUIPO"), student("p1", "b", "alumno", null, "SIN_EQUIPO"),
      student("p1", "b", "desertor", "team-2", "DESERTOR"), student("p1", "ajena", "ajeno"), student("cancel", "d", "excluido")],
  };
  const report = buildCoordinationMonitoring(input, "2026-11-05");
  assert.deepEqual(report.campusComparisons, [
    { campusName: "Aurora", projectCount: 2, enrolledStudents: 2, participatingStudents: 1, studentParticipationPercent: 50,
      totalSections: 2, completedSectionMilestones: 4, totalSectionMilestones: 6, sectionProgressPercent: 66.7 },
    { campusName: "Bosque", projectCount: 1, enrolledStudents: 2, participatingStudents: 0, studentParticipationPercent: 0,
      totalSections: 1, completedSectionMilestones: 0, totalSectionMilestones: 3, sectionProgressPercent: 0 },
  ]);
  assert.equal(report.indicators.milestones[2].completedProjects, 0);
  const campus = buildCoordinationMonitoring(input, "2026-11-05", { campus: "Aurora" });
  assert.deepEqual(campus.campusComparisons, [report.campusComparisons[0]]);
  assert.equal(campus.indicators.totalSections, 3, "El resumen global conserva las secciones de otras sedes.");
});

test("los gráficos respetan filtros combinados y distinguen ausencia de matrícula de participación cero", () => {
  const input = { projectRows: [project("abierto"), project("cerrado", "FINALIZADO")],
    sectionRows: [section("abierto", "a", 0, { campusName: "Aurora" }), section("cerrado", "b", 3, { campusName: "Bosque" })] };
  const all = buildCoordinationMonitoring(input, "2026-11-05");
  assert.equal(all.campusComparisons[0].studentParticipationPercent, null);
  assert.equal(all.campusComparisons[0].sectionProgressPercent, 0);
  const finished = buildCoordinationMonitoring(input, "2026-11-05", { scope: "finished", campus: "Bosque", search: "cerrado" });
  assert.equal(finished.campusComparisons.length, 1);
  assert.equal(finished.campusComparisons[0].sectionProgressPercent, 100);
  assert.equal(finished.campusComparisons[0].projectCount, 1);
  assert.deepEqual(buildCoordinationMonitoring(input, "2026-11-05", { scope: "finished", campus: "Aurora" }).campusComparisons, []);
  assert.deepEqual(buildCoordinationMonitoring(input, "2026-11-05", { search: "sin coincidencias" }).campusComparisons, []);
  assert.deepEqual(buildCoordinationMonitoring({}).campusComparisons, []);
});
