const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { buildCoordinationMonitoring } = require("../src/lib/coordinationMonitoring");
const { writeCoordinationWorkbook } = require("../src/lib/coordinationWorkbook");

test("genera un libro Excel con las hojas operativas y los socios formadores", async () => {
  const report = buildCoordinationMonitoring({
    projectRows: [{
      databaseId: "project-db-1", id: "VCM-2026-001", name: "Proyecto Excel",
      status: "EN_EJECUCION", subjectCode: "DSY1105", subjectName: "Desarrollo móvil",
      startDate: "2026-08-01", endDate: null, availableFrom: null,
    }],
    sectionRows: [{
      projectId: "project-db-1", id: "section-1", code: "DSY1105-001D", shift: "Diurno",
      campusName: "Concepción", studentCount: 1, teamCount: 1, assignedStudentCount: 1,
      hito1Status: "COMPLETADO", hito2Status: "PENDIENTE", hito3Status: "PENDIENTE",
      hito1CompletedAt: "2026-08-16T12:00:00",
    }],
    teacherRows: [{
      projectId: "project-db-1", sectionId: "section-1", id: "teacher-1",
      name: "Docente Excel", email: "docente@duoc.cl", accountLinked: true,
    }],
  }, "2026-08-17");
  report.filters = { scope: "all", campus: "all", search: "" };
  const students = [{
    projectId: "VCM-2026-001", projectName: "Proyecto Excel", subjectCode: "DSY1105",
    subjectName: "Desarrollo móvil", campusName: "Concepción", sectionId: "section-1",
    sectionCode: "DSY1105-001D", shift: "Diurno", studentId: "student-1",
    sourceId: "ALU-001", rut: "11.111.111-1", studentName: "Alumno Excel",
    studentEmail: "alumno@duoc.cl", teamName: "Equipo 1", assignmentStatus: "ASIGNADO",
  }];
  const partner = {
    id: "partner-1", businessName: "Fundación Excel", taxId: "76.123.456-7", industry: "Educación",
    contactName: "Contacto Excel", contactEmail: "contacto@fundacion.cl", phone: "+56 9 1234 5678",
  };
  const partners = [
    { ...partner, projectId: "VCM-2026-001", projectName: "Proyecto Excel" },
    { ...partner, projectId: "VCM-2026-002", projectName: "Segundo proyecto Excel" },
    {
      id: "partner-2", businessName: "Socio sin proyecto", taxId: "77.987.654-3", industry: "Servicios",
      contactName: "Contacto Disponible", contactEmail: "disponible@socio.cl", phone: "+56 41 234 5678",
      projectId: null, projectName: null,
    },
  ];

  const buffer = await writeCoordinationWorkbook({ report, students, partners });
  assert.equal(buffer.subarray(0, 2).toString(), "PK");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Resumen proyectos", "Socios formadores", "Secciones", "Docentes", "Alumnos", "Alertas",
  ]);
  assert.equal(workbook.getWorksheet("Resumen proyectos").rowCount, 2);
  const partnerSheet = workbook.getWorksheet("Socios formadores");
  assert.equal(partnerSheet.rowCount, 3);
  assert.equal(partnerSheet.getCell("A2").value, "Fundación Excel");
  assert.equal(partnerSheet.getCell("G2").value, 2);
  assert.equal(partnerSheet.getCell("H2").value, "VCM-2026-001, VCM-2026-002");
  assert.equal(partnerSheet.getCell("I2").value, "Proyecto Excel / Segundo proyecto Excel");
  assert.equal(partnerSheet.getCell("A3").value, "Socio sin proyecto");
  assert.equal(partnerSheet.getCell("G3").value, 0);
  assert.equal(partnerSheet.getCell("H3").value, "");
  assert.equal(partnerSheet.getCell("I3").value, "");
  assert.equal(workbook.getWorksheet("Secciones").getCell("Q2").value, "Hito 1 completo");
  assert.equal(workbook.getWorksheet("Docentes").getCell("D2").value, "Docente Excel");
  assert.equal(workbook.getWorksheet("Alumnos").getCell("J2").value, "Alumno Excel");
  assert.equal(workbook.getWorksheet("Alumnos").getCell("M2").value, "Asignado");
  assert.equal(workbook.getWorksheet("Alumnos").getCell("N2").value, "Hito 1 completo");
  assert.equal(workbook.getWorksheet("Alertas").rowCount, 2);
});
