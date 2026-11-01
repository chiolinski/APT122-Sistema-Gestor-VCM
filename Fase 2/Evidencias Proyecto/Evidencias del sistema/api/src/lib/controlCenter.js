const { AppError } = require("./http");
const { normalizePagination } = require("./pilotReports");

const SEVERITIES = new Set(["all", "high", "medium", "info"]);

function assertControlAccess(principal) {
  if (!principal || !["admin", "coordinator"].includes(principal.role)) {
    throw new AppError(403, "CONTROL_ACCESS_DENIED", "No tienes permisos para consultar el centro de control.");
  }
  return principal;
}

function normalizeControlFilters(input = {}) {
  const pagination = normalizePagination(input.page, input.pageSize);
  const severity = String(input.severity || "all").trim().toLowerCase();
  if (!SEVERITIES.has(severity)) {
    throw new AppError(400, "INVALID_QUALITY_SEVERITY", "El filtro de prioridad no es válido.");
  }
  return {
    ...pagination,
    query: String(input.query || "").trim().slice(0, 200),
    action: String(input.action || "all").trim().slice(0, 60) || "all",
    entity: String(input.entity || "all").trim().slice(0, 60) || "all",
    severity,
  };
}

function createIssue(type, severity, row, definition) {
  const entityId = String(row.id || row.sectionId || row.projectId || row.email || "general");
  return {
    id: `${type}:${entityId}`,
    type,
    severity,
    entityId,
    title: definition.title(row),
    description: definition.description(row),
    recommendation: definition.recommendation,
    actionUrl: definition.actionUrl?.(row) || null,
    context: definition.context?.(row) || {},
  };
}

function buildDataQualityReport(rows = {}) {
  const issues = [
    ...(rows.unlinkedTeachers || []).map((row) => createIssue("UNLINKED_TEACHER", "high", row, {
      title: (item) => `${item.name} no tiene una cuenta vinculada`,
      description: (item) => `${item.sections} ${item.sections === 1 ? "sección vigente depende" : "secciones vigentes dependen"} de este docente${item.email ? ` (${item.email})` : " sin correo registrado"}.`,
      recommendation: "Crear o vincular la cuenta antes de iniciar el trabajo docente.",
      context: (item) => ({ teacherName: item.name, email: item.email, sections: item.sections }),
    })),
    ...(rows.sectionsWithoutTeachers || []).map((row) => createIssue("SECTION_WITHOUT_TEACHER", "high", row, {
      title: (item) => `${item.subjectCode} ${item.sectionCode} no tiene docente`,
      description: (item) => `${item.projectCode} · ${item.campusName}. La sección está vinculada al piloto pero no tiene una asignación docente vigente.`,
      recommendation: "Corregir la carga académica o asignar un docente antes de continuar.",
      actionUrl: () => "/app/seguimiento",
      context: (item) => ({ projectCode: item.projectCode, campusName: item.campusName, sectionCode: item.sectionCode }),
    })),
    ...(rows.sectionsWithoutStudents || []).map((row) => createIssue("SECTION_WITHOUT_STUDENTS", "medium", row, {
      title: (item) => `${item.subjectCode} ${item.sectionCode} no tiene estudiantes`,
      description: (item) => `${item.projectCode} · ${item.campusName}. No existe una matrícula vigente para esta sección del proyecto.`,
      recommendation: "Revisar la carga académica antes de solicitar la formación de equipos.",
      actionUrl: () => "/app/seguimiento",
      context: (item) => ({ projectCode: item.projectCode, campusName: item.campusName, sectionCode: item.sectionCode }),
    })),
    ...(rows.incompleteTeams || []).map((row) => createIssue("INCOMPLETE_TEAMS", "medium", row, {
      title: (item) => `${item.projectCode} · ${item.sectionCode} tiene estudiantes sin equipo`,
      description: (item) => `${item.assignedStudents} de ${item.students} estudiantes están distribuidos en ${item.teams} equipos.`,
      recommendation: "Completar la distribución de la sección o retirar equipos parciales incorrectos.",
      actionUrl: (item) => `/app/proyectos/${encodeURIComponent(item.projectCode)}?section=${encodeURIComponent(item.sectionId)}#equipos`,
      context: (item) => ({ projectCode: item.projectCode, sectionCode: item.sectionCode, students: item.students, assignedStudents: item.assignedStudents }),
    })),
    ...(rows.teacherAccountsWithoutAssignments || []).map((row) => createIssue("TEACHER_ACCOUNT_WITHOUT_ASSIGNMENT", "info", row, {
      title: (item) => `${item.name} tiene cuenta docente sin carga vigente`,
      description: (item) => `${item.email} puede iniciar sesión, pero no tiene una asignatura y sección activa asociada.`,
      recommendation: "Confirmar si la cuenta debe mantenerse activa o corregir la carga académica.",
      context: (item) => ({ email: item.email, teacherName: item.name }),
    })),
    ...(rows.invalidMemberships || []).map((row) => createIssue("INVALID_TEAM_MEMBERSHIP", "high", row, {
      title: (item) => `${item.studentName} figura en un equipo incompatible`,
      description: (item) => `${item.projectCode} · ${item.sectionCode}. La pertenencia del estudiante no coincide con la sección o el proyecto del equipo.`,
      recommendation: "Reconstruir el equipo desde la sección correcta para restaurar la consistencia.",
      actionUrl: (item) => `/app/proyectos/${encodeURIComponent(item.projectCode)}?section=${encodeURIComponent(item.sectionId)}#equipos`,
      context: (item) => ({ projectCode: item.projectCode, sectionCode: item.sectionCode, studentName: item.studentName }),
    })),
  ];
  const order = { high: 0, medium: 1, info: 2 };
  issues.sort((left, right) => order[left.severity] - order[right.severity] || left.title.localeCompare(right.title, "es"));
  const summary = {
    total: issues.length,
    high: issues.filter((issue) => issue.severity === "high").length,
    medium: issues.filter((issue) => issue.severity === "medium").length,
    info: issues.filter((issue) => issue.severity === "info").length,
    teachers: issues.filter((issue) => issue.type.includes("TEACHER")).length,
    sections: issues.filter((issue) => ["SECTION_WITHOUT_TEACHER", "SECTION_WITHOUT_STUDENTS", "INCOMPLETE_TEAMS"].includes(issue.type)).length,
  };
  return { generatedAt: new Date().toISOString(), status: summary.high ? "attention" : summary.total ? "review" : "healthy", summary, issues };
}

function buildNotifications({ coordinationAlerts = [], qualityReport = null, teachingRows = [], readKeys = [] }) {
  const read = new Set(readKeys);
  const records = [];
  coordinationAlerts.forEach((alert) => records.push({
    key: `coordination:${alert.id}`,
    type: "coordination",
    tone: alert.priority === "high" ? "high" : alert.priority === "medium" ? "medium" : "info",
    title: alert.title,
    message: alert.message,
    actionUrl: "/app/seguimiento",
  }));
  if (qualityReport?.summary.total) {
    const { high, medium, info } = qualityReport.summary;
    records.push({
      key: `quality:${high}:${medium}:${info}`,
      type: "quality",
      tone: high ? "high" : "medium",
      title: `${qualityReport.summary.total} observaciones de calidad de datos`,
      message: high ? `${high} requieren atención prioritaria antes de continuar el piloto.` : "Hay datos que conviene revisar para mantener el piloto consistente.",
      actionUrl: "/app/control",
    });
  }
  teachingRows.forEach((row) => {
    let notification = null;
    if (row.hito1Status !== "COMPLETADO") {
      notification = {
        key: `teaching:${row.projectCode}:${row.sectionId}:h1`, type: "teaching", tone: "medium",
        title: `Forma los equipos de ${row.sectionCode}`,
        message: `${row.projectName} · ${row.campusName}. La sección todavía no completa el Hito 1.`,
        actionUrl: `/app/proyectos/${encodeURIComponent(row.projectCode)}?section=${encodeURIComponent(row.sectionId)}#equipos`,
      };
    } else if (row.hito2Status !== "COMPLETADO" && row.hito2Available) {
      notification = {
        key: `teaching:${row.projectCode}:${row.sectionId}:h2:${row.availableFrom || "open"}`, type: "teaching", tone: "info",
        title: `Hito 2 disponible para ${row.sectionCode}`,
        message: `${row.projectName} · ${row.campusName}. Ya puedes registrar el avance de esta sección.`,
        actionUrl: `/app/proyectos/${encodeURIComponent(row.projectCode)}?section=${encodeURIComponent(row.sectionId)}#control-hitos`,
      };
    } else if (row.hito2Status === "COMPLETADO" && row.hito3Status !== "COMPLETADO") {
      notification = {
        key: `teaching:${row.projectCode}:${row.sectionId}:h3`, type: "teaching", tone: "info",
        title: `${row.sectionCode} está lista para cierre`,
        message: `${row.projectName} · ${row.campusName}. Completa el Hito 3 cuando finalice el seguimiento.`,
        actionUrl: `/app/proyectos/${encodeURIComponent(row.projectCode)}?section=${encodeURIComponent(row.sectionId)}#control-hitos`,
      };
    }
    if (notification) records.push(notification);
  });
  const unique = [...new Map(records.map((record) => [record.key, record])).values()]
    .map((record) => ({ ...record, read: read.has(record.key) }));
  const toneOrder = { high: 0, medium: 1, info: 2 };
  unique.sort((left, right) => Number(left.read) - Number(right.read) || toneOrder[left.tone] - toneOrder[right.tone] || left.title.localeCompare(right.title, "es"));
  return { records: unique, unreadCount: unique.filter((record) => !record.read).length };
}

module.exports = { assertControlAccess, buildDataQualityReport, buildNotifications, normalizeControlFilters };
