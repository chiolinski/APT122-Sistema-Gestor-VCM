const ExcelJS = require("exceljs");

const COLORS = {
  ink: "FF171717",
  yellow: "FFFFB800",
  line: "FFE3E3DF",
};

function formatDate(value) {
  return value || "";
}

function yesNo(value) {
  return value ? "Sí" : "No";
}

function addWorksheet(workbook, name, columns, rows) {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  worksheet.columns = columns.map((column) => ({
    key: column.key,
    header: column.header,
    width: column.width || 18,
    style: { alignment: { vertical: "top", wrapText: true } },
  }));
  worksheet.addRows(rows);
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  worksheet.getRow(1).height = 30;
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: COLORS.ink, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.yellow } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.ink } } };
  });
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { color: COLORS.ink, size: 9 };
      cell.border = { bottom: { style: "hair", color: { argb: COLORS.line } } };
      if (rowNumber % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAF8" } };
    });
  });
  worksheet.headerFooter.oddFooter = "&LSistema Gestor de Proyectos de Asignaturas&C&P de &N&RGenerado desde Seguimiento";
  return worksheet;
}

function aggregatePartners(sourcePartners) {
  const partnerGroups = new Map();
  (sourcePartners || []).forEach((source) => {
    const key = source.id || source.taxId || source.businessName;
    if (!partnerGroups.has(key)) {
      partnerGroups.set(key, {
        ...source,
        projectIds: new Set(),
        projectNames: new Set(),
      });
    }
    const partner = partnerGroups.get(key);
    if (source.projectId) partner.projectIds.add(source.projectId);
    if (source.projectName) partner.projectNames.add(source.projectName);
  });

  return [...partnerGroups.values()]
    .sort((left, right) => left.businessName.localeCompare(right.businessName, "es"))
    .map((partner) => ({
      businessName: partner.businessName,
      taxId: partner.taxId,
      industry: partner.industry || "",
      contactName: partner.contactName || "",
      contactEmail: partner.contactEmail || "",
      phone: partner.phone || "",
      projectCount: partner.projectIds.size,
      projectIds: [...partner.projectIds].join(", "),
      projectNames: [...partner.projectNames].join(" / "),
    }));
}

function createCoordinationWorkbook({ report, students, partners = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistema Gestor de Proyectos de Asignaturas";
  workbook.company = "Duoc UC";
  workbook.subject = "Seguimiento de proyectos de Vinculación con el Medio";
  workbook.title = "Seguimiento VCM 2026";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  addWorksheet(workbook, "Resumen proyectos", [
    { key: "projectId", header: "Código proyecto", width: 18 },
    { key: "projectName", header: "Proyecto", width: 34 },
    { key: "subjectCode", header: "Código asignatura", width: 18 },
    { key: "subjectName", header: "Asignatura", width: 34 },
    { key: "campuses", header: "Sedes", width: 38 },
    { key: "status", header: "Estado global", width: 16 },
    { key: "progress", header: "Avance (%)", width: 13 },
    { key: "sections", header: "Secciones", width: 12 },
    { key: "students", header: "Alumnos", width: 12 },
    { key: "teachers", header: "Docentes", width: 12 },
    { key: "teams", header: "Equipos", width: 12 },
    { key: "hito1", header: "Hito 1 completado", width: 18 },
    { key: "hito2", header: "Hito 2 completado", width: 18 },
    { key: "hito3", header: "Hito 3 completado", width: 18 },
    { key: "availableFrom", header: "Apertura Hito 2", width: 17 },
    { key: "pending", header: "Secciones pendientes", width: 18 },
    { key: "overdue", header: "Secciones atrasadas", width: 18 },
    { key: "teacherFollowUps", header: "Seguimientos docentes cerrados", width: 24 },
  ], report.projects.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    subjectCode: project.subjectCode,
    subjectName: project.subjectName,
    campuses: project.campuses.join(", "),
    status: project.status,
    progress: project.progressPercent,
    sections: project.sectionCount,
    students: project.sections.reduce((total, section) => total + section.studentCount, 0),
    teachers: project.teacherCount,
    teams: project.sections.reduce((total, section) => total + section.teamCount, 0),
    hito1: `${project.completedByMilestone[0]}/${project.sectionCount}`,
    hito2: `${project.completedByMilestone[1]}/${project.sectionCount}`,
    hito3: `${project.completedByMilestone[2]}/${project.sectionCount}`,
    availableFrom: formatDate(project.availableFrom),
    pending: project.pendingSections,
    overdue: project.overdueSections,
    teacherFollowUps: `${project.completedTeachers}/${project.teacherCount}`,
  })));

  const partnerSheet = addWorksheet(workbook, "Socios formadores", [
    { key: "businessName", header: "Razón social", width: 38 },
    { key: "taxId", header: "RUT", width: 16 },
    { key: "industry", header: "Rubro", width: 26 },
    { key: "contactName", header: "Nombre de contacto", width: 30 },
    { key: "contactEmail", header: "Correo de contacto", width: 34 },
    { key: "phone", header: "Teléfono", width: 18 },
    { key: "projectCount", header: "Proyectos asociados", width: 20 },
    { key: "projectIds", header: "Códigos de proyecto", width: 34 },
    { key: "projectNames", header: "Proyectos", width: 48 },
  ], aggregatePartners(partners));
  partnerSheet.getColumn("projectCount").alignment = { horizontal: "center", vertical: "top" };

  addWorksheet(workbook, "Secciones", [
    { key: "projectId", header: "Código proyecto", width: 18 },
    { key: "projectName", header: "Proyecto", width: 32 },
    { key: "subjectCode", header: "Asignatura", width: 16 },
    { key: "campus", header: "Sede", width: 25 },
    { key: "section", header: "Sección", width: 17 },
    { key: "shift", header: "Jornada", width: 13 },
    { key: "teachers", header: "Docentes", width: 38 },
    { key: "students", header: "Alumnos", width: 12 },
    { key: "assignedStudents", header: "En equipos", width: 12 },
    { key: "teams", header: "Equipos", width: 11 },
    { key: "hito1", header: "Hito 1", width: 13 },
    { key: "hito1Date", header: "Fecha Hito 1", width: 20 },
    { key: "hito2", header: "Hito 2", width: 13 },
    { key: "hito2Date", header: "Fecha Hito 2", width: 20 },
    { key: "hito3", header: "Hito 3", width: 13 },
    { key: "hito3Date", header: "Fecha Hito 3", width: 20 },
    { key: "sectionStatus", header: "Estado sección", width: 20 },
    { key: "overdue", header: "Atrasada", width: 11 },
  ], report.projects.flatMap((project) => project.sections.map((section) => ({
    projectId: project.id,
    projectName: project.name,
    subjectCode: project.subjectCode,
    campus: section.campusName,
    section: section.code,
    shift: section.shift || "",
    teachers: section.teachers.map((teacher) => teacher.name).join(" / ") || "Sin docente asignado",
    students: section.studentCount,
    assignedStudents: section.assignedStudentCount,
    teams: section.teamCount,
    hito1: section.milestones[0].status,
    hito1Date: formatDate(section.milestones[0].completedAt),
    hito2: section.milestones[1].status,
    hito2Date: formatDate(section.milestones[1].completedAt),
    hito3: section.milestones[2].status,
    hito3Date: formatDate(section.milestones[2].completedAt),
    sectionStatus: section.overdue ? "Atrasada" : section.status,
    overdue: yesNo(section.overdue),
  }))));

  addWorksheet(workbook, "Docentes", [
    { key: "projectId", header: "Código proyecto", width: 18 },
    { key: "projectName", header: "Proyecto", width: 32 },
    { key: "subjectCode", header: "Asignatura", width: 16 },
    { key: "teacher", header: "Docente", width: 30 },
    { key: "email", header: "Correo", width: 34 },
    { key: "sections", header: "Secciones asignadas", width: 38 },
    { key: "totalSections", header: "Total secciones", width: 15 },
    { key: "completedSections", header: "Secciones cerradas", width: 18 },
    { key: "status", header: "Estado seguimiento", width: 18 },
    { key: "accountLinked", header: "Cuenta vinculada", width: 17 },
  ], report.projects.flatMap((project) => project.teachers.map((teacher) => ({
    projectId: project.id,
    projectName: project.name,
    subjectCode: project.subjectCode,
    teacher: teacher.name,
    email: teacher.email || "",
    sections: project.sections.filter((section) => teacher.sectionIds.includes(section.id)).map((section) => `${section.code} (${section.campusName})`).join(", "),
    totalSections: teacher.totalSections,
    completedSections: teacher.completedSections,
    status: teacher.status,
    accountLinked: yesNo(teacher.accountLinked),
  }))));

  const sectionLookup = new Map(report.projects.flatMap((project) => project.sections.map((section) => [`${project.id}:${section.id}`, section])));
  addWorksheet(workbook, "Alumnos", [
    { key: "projectId", header: "Código proyecto", width: 18 },
    { key: "projectName", header: "Proyecto", width: 32 },
    { key: "subjectCode", header: "Código asignatura", width: 18 },
    { key: "subjectName", header: "Asignatura", width: 32 },
    { key: "campus", header: "Sede", width: 24 },
    { key: "section", header: "Sección", width: 17 },
    { key: "shift", header: "Jornada", width: 13 },
    { key: "sourceId", header: "Identificador académico", width: 22 },
    { key: "rut", header: "RUT", width: 15 },
    { key: "student", header: "Alumno", width: 32 },
    { key: "email", header: "Correo", width: 34 },
    { key: "team", header: "Equipo", width: 18 },
    { key: "studentStatus", header: "Estado estudiante", width: 20 },
    { key: "sectionStatus", header: "Estado de la sección", width: 20 },
  ], students.map((student) => {
    const section = sectionLookup.get(`${student.projectId}:${student.sectionId}`);
    return {
      projectId: student.projectId,
      projectName: student.projectName,
      subjectCode: student.subjectCode,
      subjectName: student.subjectName,
      campus: student.campusName,
      section: student.sectionCode,
      shift: student.shift || "",
      sourceId: student.sourceId || "",
      rut: student.rut,
      student: student.studentName,
      email: student.studentEmail || "",
      team: student.teamName || "Sin equipo",
      studentStatus: ({ ASIGNADO: "Asignado", SIN_EQUIPO: "Sin equipo", DESERTOR: "Desertor" })[student.assignmentStatus] || "Sin equipo",
      sectionStatus: section ? (section.overdue ? "Atrasada" : section.status) : "Sin estado",
    };
  }));

  const alertLabels = {
    UNASSIGNED_SECTIONS: "Secciones sin docente",
    OVERDUE_SECTIONS: "Secciones atrasadas",
    READY_FOR_HITO_2: "Listo para programar Hito 2",
    PENDING_HITO_2: "Hito 2 pendiente",
    READY_FOR_CLOSURE: "Listo para cierre",
  };
  addWorksheet(workbook, "Alertas", [
    { key: "priority", header: "Prioridad", width: 13 },
    { key: "projectId", header: "Código proyecto", width: 18 },
    { key: "projectName", header: "Proyecto", width: 34 },
    { key: "type", header: "Tipo", width: 28 },
    { key: "title", header: "Alerta", width: 34 },
    { key: "message", header: "Descripción", width: 62 },
  ], report.alerts.map((alert) => ({
    priority: { high: "Alta", medium: "Media", info: "Informativa" }[alert.priority] || alert.priority,
    projectId: alert.projectId,
    projectName: report.projects.find((project) => project.id === alert.projectId)?.name || "",
    type: alertLabels[alert.type] || alert.type,
    title: alert.title,
    message: alert.message,
  })));

  const summarySheet = workbook.getWorksheet("Resumen proyectos");
  summarySheet.getColumn("progress").numFmt = "0\"%\"";
  ["hito1", "hito2", "hito3"].forEach((key) => {
    const column = summarySheet.getColumn(key);
    column.alignment = { horizontal: "center", vertical: "top" };
  });
  return workbook;
}

async function writeCoordinationWorkbook(data) {
  const workbook = createCoordinationWorkbook(data);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { createCoordinationWorkbook, writeCoordinationWorkbook };
