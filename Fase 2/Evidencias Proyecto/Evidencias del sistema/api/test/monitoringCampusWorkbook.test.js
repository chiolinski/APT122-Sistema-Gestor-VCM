const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { JSDOM } = require("jsdom");
const { buildCoordinationMonitoring } = require("../src/lib/coordinationMonitoring");
const { writeCoordinationWorkbook } = require("../src/lib/coordinationWorkbook");

const CAMPUS = 'Sede ficticia A & <Norte> "Uno"';
function input() {
  const section = (projectId, id, campusName, complete) => ({ projectId, id, code: id, campusName,
    hito1Status: complete ? "COMPLETADO" : "PENDIENTE", hito2Status: complete ? "COMPLETADO" : "PENDIENTE", hito3Status: complete ? "COMPLETADO" : "PENDIENTE" });
  return {
    projectRows: [
      { databaseId: "a", id: "DEMO-A", name: "Proyecto compartido ficticio", status: "EN_EJECUCION" },
      { databaseId: "b", id: "DEMO-B", name: "Proyecto cerrado ficticio", status: "FINALIZADO", availableFrom: "2026-10-01" },
      { databaseId: "c", id: "DEMO-C", name: "Proyecto cancelado ficticio", status: "CANCELADO" },
    ],
    sectionRows: [section("a", "s1", CAMPUS, true), section("a", "s2", "Sede ficticia B", false), section("b", "s3", CAMPUS, true), section("c", "s4", "Sede ficticia cancelada", true)],
    studentRows: [
      { projectId: "a", sectionId: "s1", studentId: "student1", teamId: "team1", assignmentStatus: "ASIGNADO" },
      { projectId: "a", sectionId: "s1", studentId: "student2", assignmentStatus: "SIN_EQUIPO" },
      { projectId: "b", sectionId: "s3", studentId: "student1", teamId: "team2", assignmentStatus: "ASIGNADO" },
    ],
  };
}
async function exported(filters = {}, source = input()) {
  const report = buildCoordinationMonitoring(source, "2026-11-05", filters);
  const buffer = await writeCoordinationWorkbook({ report, students: [] });
  const zip = await JSZip.loadAsync(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { report, zip, workbook, sheet: workbook.getWorksheet("Comparación por sede") };
}
async function xml(zip, path) {
  const raw = await zip.file(path).async("string");
  return new JSDOM(raw, { contentType: "text/xml" }).window.document;
}
const charts = (zip) => Object.keys(zip.files).filter((path) => /^xl\/charts\/[^/]+\.xml$/.test(path));
const all = (node, path) => path.split(" ").reduce((nodes, name) => nodes.flatMap((parent) => [...parent.getElementsByTagNameNS("*", name)]), [node]);
const one = (node, path) => all(node, path)[0];

test("exporta dos gráficos nativos con referencias a los datos y cachés iguales a la comparación por sede", async () => {
  const { report, zip, sheet } = await exported();
  assert.equal(sheet.getCell("B2").value, "Todas las sedes");
  assert.equal(sheet.getCell("B3").value, "Todos");
  assert.equal(sheet.getCell("A9").value, CAMPUS);
  assert.equal(sheet.getCell("B9").value, 2);
  assert.equal(sheet.getCell("C9").value, 2);
  assert.equal(sheet.getCell("D9").value, 1);
  assert.equal(sheet.getCell("E9").result, 0.5);
  assert.equal(sheet.getCell("E9").formula, 'IF(C9=0,"Sin matrícula",ROUND(D9/C9,3))');
  assert.equal(sheet.getCell("I9").result, 1);
  assert.equal(sheet.getCell("E10").result, "Sin matrícula");
  assert.equal(charts(zip).length, 2);
  for (const [index, path] of charts(zip).entries()) {
    const chart = await xml(zip, path);
    assert.equal(one(chart, "barDir").getAttribute("val"), "bar");
    assert.equal(one(chart, "valAx max").getAttribute("val"), "1");
    assert.equal(one(chart, "valAx min").getAttribute("val"), "0");
    assert.equal(one(chart, "valAx majorUnit").getAttribute("val"), "0.25");
    assert.equal(one(chart, "catAx crosses").getAttribute("val"), "autoZero", "Las barras parten de cero.");
    assert.deepEqual(all(chart, "strCache pt v").map((node) => node.textContent), report.campusComparisons.map((row) => row.campusName));
    const field = index === 0 ? "studentParticipationPercent" : "sectionProgressPercent";
    const cache = all(chart, "numCache pt");
    assert.equal(cache.length, report.campusComparisons.filter((row) => row[field] !== null).length);
    cache.forEach((node) => assert.equal(Number(node.textContent), report.campusComparisons[Number(node.getAttribute("idx"))][field] / 100));
    assert.equal(one(chart, "numRef f").textContent, `'Comparación por sede'!$${index === 0 ? "E" : "I"}$9:$${index === 0 ? "E" : "I"}$10`);
  }
  // Comprueba el paquete completo, no sólo que ExcelJS pueda leer sus celdas.
  for (const path of Object.keys(zip.files).filter((path) => /\.(xml|rels)$/.test(path))) await xml(zip, path);
  const sheetRel = await xml(zip, `xl/worksheets/_rels/sheet${sheet.id}.xml.rels`);
  assert.equal(sheetRel.querySelector("Relationship").getAttribute("Target"), "../drawings/monitoringCampus.xml");
  const sheetXml = await xml(zip, `xl/worksheets/sheet${sheet.id}.xml`);
  assert.equal(sheetXml.querySelector("drawing").getAttribute("r:id"), "rIdCampusCharts");
  const drawing = await xml(zip, "xl/drawings/monitoringCampus.xml");
  assert.equal(all(drawing, "twoCellAnchor").length, 2);
  const drawingRels = await xml(zip, "xl/drawings/_rels/monitoringCampus.xml.rels");
  for (const relation of drawingRels.querySelectorAll("Relationship")) {
    assert.ok(zip.file(`xl/${relation.getAttribute("Target").replace("../", "")}`));
    assert.equal(relation.hasAttribute("TargetMode"), false);
  }
  const types = await xml(zip, "[Content_Types].xml");
  assert.equal([...types.querySelectorAll("Override")].filter((node) => node.getAttribute("ContentType").endsWith("drawingml.chart+xml")).length, 2);
});

test("sede, estado y búsqueda limitan tanto los datos como las referencias y cachés de los gráficos", async () => {
  const { zip, sheet, report } = await exported({ campus: CAMPUS, scope: "finished", search: "cerrado" });
  assert.equal(report.projects.length, 1);
  assert.equal(sheet.getCell("B2").value, CAMPUS);
  assert.equal(sheet.getCell("B3").value, "Finalizados");
  assert.equal(sheet.getCell("B4").value, "cerrado");
  assert.equal(sheet.getCell("B9").value, 1);
  assert.equal(sheet.getCell("E9").result, 1);
  assert.equal(sheet.getCell("I9").result, 1);
  assert.equal(sheet.getCell("A10").value, null);
  for (const path of charts(zip)) {
    const chart = await xml(zip, path);
    assert.equal(all(chart, "strCache pt").length, 1);
    assert.equal(one(chart, "strCache pt v").textContent, CAMPUS);
    assert.equal(one(chart, "numCache pt v").textContent, "1");
    assert.match(one(chart, "numRef f").textContent, /\$9:\$[EI]\$9$/);
  }
});

test("una selección vacía conserva filtros y mensaje sin gráficos ni filas de otras selecciones", async () => {
  const { zip, sheet } = await exported({ campus: CAMPUS, scope: "finished", search: "=sin coincidencias" });
  assert.equal(sheet.getCell("B4").value, "=sin coincidencias", "La búsqueda se guarda como texto, sin fórmula.");
  assert.equal(sheet.getCell("B4").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A9").value, "No hay sedes con proyectos para estos filtros.");
  assert.equal(charts(zip).length, 0);
  assert.equal(zip.file("xl/drawings/monitoringCampus.xml"), null);
});

test("sin matrícula conserva avance y omite el gráfico de participación sin convertir ausencias en cero", async () => {
  const source = input();
  source.studentRows = [];
  const { zip, sheet } = await exported({ campus: CAMPUS }, source);
  assert.equal(sheet.getCell("E9").result, "Sin matrícula");
  assert.equal(charts(zip).length, 1);
  const chart = await xml(zip, charts(zip)[0]);
  assert.match(one(chart, "title").textContent, /Avance de hitos/);
  const drawing = await xml(zip, "xl/drawings/monitoringCampus.xml");
  const firstRow = Number(one(drawing, "from row").textContent) + 1;
  assert.ok(firstRow > 12, "El gráfico de avance no tapa el aviso de matrícula ausente.");
  assert.equal(sheet.getCell("A12").value, "Participación estudiantil: sin matrícula para calcular el gráfico.");
});
