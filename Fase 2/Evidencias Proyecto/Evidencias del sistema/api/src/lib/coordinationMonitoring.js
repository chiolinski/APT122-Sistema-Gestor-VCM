const { AppError } = require("./http");

const STATUS_LABELS = {
  PLANIFICADO: "Planificado",
  EN_EJECUCION: "En ejecución",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};

const PRIORITY_ORDER = { high: 0, medium: 1, info: 2 };
const MONITORING_SCOPES = new Set(["all", "attention", "ready", "finished"]);

function assertMonitoringAccess(principal) {
  if (!principal || !["admin", "coordinator"].includes(principal.role)) {
    throw new AppError(403, "MONITORING_ACCESS_DENIED", "No tienes permisos para consultar el seguimiento de coordinación.");
  }
  return principal;
}

function groupBy(rows, keySelector) {
  return (rows || []).reduce((groups, row) => {
    const key = keySelector(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
    return groups;
  }, new Map());
}

function isComplete(status) {
  return status === "COMPLETADO" || status === "Completado";
}

function currentDateInChile() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeMonitoringFilters(input = {}) {
  const scope = String(input.scope || "all").trim().toLowerCase();
  if (!MONITORING_SCOPES.has(scope)) {
    throw new AppError(400, "INVALID_MONITORING_SCOPE", "El filtro de seguimiento no es válido.");
  }
  return {
    scope,
    campus: String(input.campus || "all").trim().slice(0, 150) || "all",
    search: String(input.search || "").trim().slice(0, 150),
  };
}

function summarizeProjects(projects) {
  const allTeachers = projects.flatMap((project) => project.teachers);
  return {
    projects: projects.length,
    sections: projects.reduce((total, project) => total + project.sectionCount, 0),
    pendingSections: projects.reduce((total, project) => total + project.pendingSections, 0),
    overdueSections: projects.reduce((total, project) => total + project.overdueSections, 0),
    completedTeacherFollowUps: allTeachers.filter((teacher) => teacher.status === "Finalizado").length,
    teacherFollowUps: allTeachers.length,
    readyProjects: projects.filter((project) => project.readyForMilestoneTwo || project.readyForClosure).length,
  };
}

function filterMonitoringReport(report, input = {}) {
  const filters = normalizeMonitoringFilters(input);
  const term = filters.search.toLocaleLowerCase("es");
  const projects = (report.projects || []).filter((project) => {
    if (filters.scope === "attention" && project.attentionSections === 0) return false;
    if (filters.scope === "ready" && !project.readyForMilestoneTwo && !project.readyForClosure) return false;
    if (filters.scope === "finished" && project.progressPercent !== 100) return false;
    if (filters.campus !== "all" && !project.campuses.includes(filters.campus)) return false;
    if (!term) return true;
    const searchable = [
      project.id, project.name, project.subjectCode, project.subjectName,
      ...project.campuses,
      ...project.sections.flatMap((section) => [
        section.code, section.campusName,
        ...section.teachers.flatMap((teacher) => [teacher.name, teacher.email]),
      ]),
    ].filter(Boolean).join(" ").toLocaleLowerCase("es");
    return searchable.includes(term);
  });
  const projectIds = new Set(projects.map((project) => project.id));
  return {
    ...report,
    filters,
    summary: summarizeProjects(projects),
    alerts: (report.alerts || []).filter((alert) => projectIds.has(alert.projectId)),
    projects,
  };
}

function buildCoordinationMonitoring({ projectRows = [], sectionRows = [], teacherRows = [] }, currentDate = currentDateInChile()) {
  const sectionsByProject = groupBy(sectionRows, (row) => row.projectId);
  const teachersBySection = groupBy(teacherRows, (row) => `${row.projectId}:${row.sectionId}`);

  const projects = projectRows.map((projectRow) => {
    const availableFrom = projectRow.availableFrom || null;
    const hito2Available = Boolean(availableFrom && availableFrom <= currentDate);
    const sections = (sectionsByProject.get(projectRow.databaseId) || []).map((sectionRow) => {
      const teachers = (teachersBySection.get(`${projectRow.databaseId}:${sectionRow.id}`) || []).map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        email: teacher.email || null,
        accountLinked: Boolean(teacher.accountLinked),
      }));
      const milestoneStatuses = [sectionRow.hito1Status, sectionRow.hito2Status, sectionRow.hito3Status];
      const completedMilestones = milestoneStatuses.filter(isComplete).length;
      const currentMilestone = completedMilestones === 3 ? null : completedMilestones + 1;
      const overdue = Boolean(projectRow.endDate && projectRow.endDate < currentDate && !isComplete(sectionRow.hito3Status));
      const waitingForHitoTwo = isComplete(sectionRow.hito1Status) && !isComplete(sectionRow.hito2Status) && hito2Available;
      const status = completedMilestones === 3
        ? "Finalizada"
        : completedMilestones === 2
          ? "Lista para cierre"
          : completedMilestones === 1
            ? (hito2Available ? "Hito 2 pendiente" : "Hito 1 completo")
            : "Hito 1 pendiente";

      return {
        id: sectionRow.id,
        code: sectionRow.code,
        shift: sectionRow.shift || null,
        campusName: sectionRow.campusName,
        studentCount: Number(sectionRow.studentCount || 0),
        teamCount: Number(sectionRow.teamCount || 0),
        assignedStudentCount: Number(sectionRow.assignedStudentCount || 0),
        completedMilestones,
        currentMilestone,
        status,
        overdue,
        needsAttention: overdue || teachers.length === 0 || waitingForHitoTwo,
        teachers,
        milestones: [
          { number: 1, status: isComplete(sectionRow.hito1Status) ? "Completado" : "Pendiente", completedAt: sectionRow.hito1CompletedAt || null },
          { number: 2, status: isComplete(sectionRow.hito2Status) ? "Completado" : "Pendiente", completedAt: sectionRow.hito2CompletedAt || null },
          { number: 3, status: isComplete(sectionRow.hito3Status) ? "Completado" : "Pendiente", completedAt: sectionRow.hito3CompletedAt || null },
        ],
      };
    }).sort((left, right) => `${left.campusName}|${left.code}`.localeCompare(`${right.campusName}|${right.code}`, "es"));

    const teacherAssignments = new Map();
    sections.forEach((section) => section.teachers.forEach((teacher) => {
      if (!teacherAssignments.has(teacher.id)) teacherAssignments.set(teacher.id, { ...teacher, sectionIds: [] });
      teacherAssignments.get(teacher.id).sectionIds.push(section.id);
    }));
    const teachers = [...teacherAssignments.values()].map((teacher) => {
      const assignedSections = sections.filter((section) => teacher.sectionIds.includes(section.id));
      const completedSections = assignedSections.filter((section) => section.completedMilestones === 3).length;
      const started = assignedSections.some((section) => section.completedMilestones > 0);
      return {
        ...teacher,
        totalSections: assignedSections.length,
        completedSections,
        status: completedSections === assignedSections.length ? "Finalizado" : started ? "En curso" : "Pendiente",
      };
    }).sort((left, right) => left.name.localeCompare(right.name, "es"));

    const completedByMilestone = [1, 2, 3].map((number) => sections.filter((section) => section.completedMilestones >= number).length);
    const totalMilestones = sections.length * 3;
    const completedMilestones = sections.reduce((total, section) => total + section.completedMilestones, 0);
    const readyForMilestoneTwo = sections.length > 0 && completedByMilestone[0] === sections.length && !availableFrom;
    const readyForClosure = sections.length > 0 && completedByMilestone[1] === sections.length && completedByMilestone[2] < sections.length;

    return {
      id: projectRow.id,
      databaseId: projectRow.databaseId,
      name: projectRow.name,
      status: STATUS_LABELS[projectRow.status] || projectRow.status,
      subjectCode: projectRow.subjectCode,
      subjectName: projectRow.subjectName,
      startDate: projectRow.startDate || null,
      endDate: projectRow.endDate || null,
      availableFrom,
      hito2Available,
      sectionCount: sections.length,
      completedByMilestone,
      progressPercent: totalMilestones ? Math.round((completedMilestones / totalMilestones) * 100) : 0,
      pendingSections: sections.filter((section) => section.completedMilestones < 3).length,
      overdueSections: sections.filter((section) => section.overdue).length,
      attentionSections: sections.filter((section) => section.needsAttention).length,
      readyForMilestoneTwo,
      readyForClosure,
      completedTeachers: teachers.filter((teacher) => teacher.status === "Finalizado").length,
      teacherCount: teachers.length,
      campuses: [...new Set(sections.map((section) => section.campusName))].sort((left, right) => left.localeCompare(right, "es")),
      sections,
      teachers,
    };
  });

  const alerts = [];
  projects.forEach((project) => {
    const unassigned = project.sections.filter((section) => section.teachers.length === 0);
    if (unassigned.length) alerts.push({
      id: `${project.id}:unassigned`, type: "UNASSIGNED_SECTIONS", priority: "high", projectId: project.id,
      title: `${unassigned.length} ${unassigned.length === 1 ? "sección sin docente" : "secciones sin docente"}`,
      message: `${project.name} necesita asignaciones antes de continuar el seguimiento.`,
    });
    if (project.overdueSections) alerts.push({
      id: `${project.id}:overdue`, type: "OVERDUE_SECTIONS", priority: "high", projectId: project.id,
      title: `${project.overdueSections} ${project.overdueSections === 1 ? "sección atrasada" : "secciones atrasadas"}`,
      message: `${project.name} superó su fecha de término y mantiene secciones abiertas.`,
    });
    if (project.readyForMilestoneTwo) alerts.push({
      id: `${project.id}:ready-h2`, type: "READY_FOR_HITO_2", priority: "medium", projectId: project.id,
      title: "Todas las secciones completaron el Hito 1",
      message: `${project.name} está listo para que coordinación programe la apertura del Hito 2.`,
    });
    if (project.hito2Available) {
      const pendingHitoTwo = project.sections.filter((section) => section.completedMilestones === 1).length;
      if (pendingHitoTwo) alerts.push({
        id: `${project.id}:pending-h2`, type: "PENDING_HITO_2", priority: "medium", projectId: project.id,
        title: `${pendingHitoTwo} ${pendingHitoTwo === 1 ? "sección pendiente" : "secciones pendientes"} en Hito 2`,
        message: `${project.name} tiene el Hito 2 disponible desde el ${project.availableFrom}.`,
      });
    }
    if (project.readyForClosure) alerts.push({
      id: `${project.id}:ready-close`, type: "READY_FOR_CLOSURE", priority: "info", projectId: project.id,
      title: "Todas las secciones completaron el Hito 2",
      message: `${project.name} ya puede completar el cierre por sección.`,
    });
  });
  alerts.sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.title.localeCompare(right.title, "es"));

  return {
    generatedAt: new Date().toISOString(),
    currentDate,
    summary: summarizeProjects(projects),
    alerts,
    projects,
  };
}

module.exports = {
  assertMonitoringAccess,
  buildCoordinationMonitoring,
  currentDateInChile,
  filterMonitoringReport,
  normalizeMonitoringFilters,
  summarizeProjects,
};
