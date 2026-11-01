const { AppError } = require("./http");
const STUDENT_ASSIGNMENT_STATUSES = new Set(["ASIGNADO", "SIN_EQUIPO", "DESERTOR"]);

function assertTeacherProjectAccess(principal, project) {
  if (!project) {
    throw new AppError(404, "PROJECT_NOT_FOUND", "No se encontró el proyecto.");
  }
  if (!["teacher", "coordinator"].includes(principal?.role) || !principal?.canTeach || !project.teacherAssigned) {
    throw new AppError(403, "PROJECT_ACCESS_DENIED", "Sólo una cuenta con docencia asignada en este proyecto puede modificarlo.");
  }
  return project;
}

function validateTeamInput(payload = {}, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  if (!Array.isArray(payload.teams) || (!allowEmpty && payload.teams.length === 0) || payload.teams.length > 20) {
    throw new AppError(400, "INVALID_TEAMS", "Debes crear entre 1 y 20 equipos.");
  }

  const teams = payload.teams.map((team) => {
    const sectionId = String(team?.sectionId || "").trim();
    const name = String(team?.name || "").trim();
    const studentIds = Array.isArray(team?.studentIds)
      ? [...new Set(team.studentIds.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];
    if (!sectionId || !name || name.length > 100 || studentIds.length === 0) {
      throw new AppError(400, "INVALID_TEAM", "Cada equipo debe indicar sección, nombre y al menos un estudiante.");
    }
    return { sectionId, name, studentIds };
  });

  const teamKeys = teams.map((team) => `${team.sectionId}|${team.name.toLowerCase()}`);
  if (new Set(teamKeys).size !== teamKeys.length) {
    throw new AppError(400, "DUPLICATE_TEAM", "No puede repetirse el nombre de un equipo dentro de una sección.");
  }
  return teams;
}

function validateStudentStates(payload = {}) {
  if (!Array.isArray(payload.students) || payload.students.length === 0) {
    throw new AppError(400, "INVALID_STUDENT_STATES", "Debes registrar el estado de todos los estudiantes de la sección.");
  }
  const students = payload.students.map((student) => {
    const studentId = String(student?.studentId || "").trim();
    const sectionId = String(student?.sectionId || "").trim();
    const status = String(student?.status || "").trim().toUpperCase();
    if (!studentId || !sectionId || !STUDENT_ASSIGNMENT_STATUSES.has(status)) {
      throw new AppError(400, "INVALID_STUDENT_STATUS", "Cada estudiante debe indicar su sección y un estado válido.");
    }
    return { studentId, sectionId, status };
  });
  if (new Set(students.map((student) => student.studentId)).size !== students.length) {
    throw new AppError(400, "DUPLICATE_STUDENT_STATUS", "No puede repetirse un estudiante en la misma asignación.");
  }
  return students;
}

function validateTeamAssignmentInput(payload = {}) {
  const teams = validateTeamInput(payload, { allowEmpty: true });
  const studentStates = validateStudentStates(payload);
  return { teams, studentStates, sectionId: getAssignmentSectionId(teams, studentStates) };
}

function validateStudentAssignmentUpdate(payload = {}) {
  const sectionId = String(payload.sectionId || "").trim();
  const status = String(payload.status || "").trim().toUpperCase();
  const teamNumber = payload.teamNumber === null || payload.teamNumber === undefined || payload.teamNumber === ""
    ? null
    : Number(payload.teamNumber);
  if (!sectionId || !STUDENT_ASSIGNMENT_STATUSES.has(status)) {
    throw new AppError(400, "INVALID_STUDENT_STATUS", "Debes indicar la sección y un estado válido para el estudiante.");
  }
  if (status === "ASIGNADO" && (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 20)) {
    throw new AppError(400, "TEAM_REQUIRED", "Selecciona un equipo entre 1 y 20 para el estudiante asignado.");
  }
  if (status !== "ASIGNADO" && teamNumber !== null) {
    throw new AppError(400, "TEAM_NOT_ALLOWED", "Un estudiante sin equipo o desertor no debe indicar un equipo.");
  }
  return { sectionId, status, teamNumber };
}

function validateRosterAssignments(teams, roster, studentStates = null) {
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new AppError(409, "PROJECT_WITHOUT_STUDENTS", "El proyecto no tiene estudiantes vigentes en las secciones asignadas.");
  }

  const students = new Map(roster.map((student) => [String(student.id), student]));
  const assigned = new Set();
  for (const team of teams) {
    for (const studentId of team.studentIds) {
      const student = students.get(studentId);
      if (!student || String(student.sectionId) !== team.sectionId) {
        throw new AppError(403, "STUDENT_OUTSIDE_ASSIGNMENT", "Un estudiante no pertenece a las secciones asignadas al docente.");
      }
      if (assigned.has(studentId)) {
        throw new AppError(400, "STUDENT_IN_MULTIPLE_TEAMS", "Cada estudiante puede pertenecer a un solo equipo.");
      }
      assigned.add(studentId);
    }
  }

  if (!studentStates && assigned.size !== students.size) {
    throw new AppError(400, "INCOMPLETE_TEAM_ASSIGNMENT", "Todos los estudiantes deben quedar asignados a un equipo.");
  }
  if (studentStates) {
    const states = new Map(studentStates.map((student) => [student.studentId, student]));
    if (states.size !== students.size) {
      throw new AppError(400, "INCOMPLETE_STUDENT_STATUS", "Debes registrar el estado de toda la nómina antes de completar el Hito 1.");
    }
    for (const studentState of studentStates) {
      const student = students.get(studentState.studentId);
      if (!student || String(student.sectionId) !== studentState.sectionId) {
        throw new AppError(403, "STUDENT_OUTSIDE_ASSIGNMENT", "Un estudiante no pertenece a la sección asignada al docente.");
      }
      const belongsToTeam = assigned.has(studentState.studentId);
      if ((studentState.status === "ASIGNADO") !== belongsToTeam) {
        throw new AppError(400, "INCONSISTENT_STUDENT_STATUS", "El estado asignado debe coincidir con la pertenencia del estudiante a un equipo.");
      }
    }
  }
  return teams;
}

function getTeamSectionId(teams) {
  const sectionIds = [...new Set((teams || []).map((team) => String(team.sectionId || "")))];
  if (sectionIds.length !== 1 || !sectionIds[0]) {
    throw new AppError(400, "TEAMS_MUST_SHARE_SECTION", "Guarda los equipos de una sola sección a la vez.");
  }
  return sectionIds[0];
}

function getAssignmentSectionId(teams, studentStates) {
  const sectionIds = [...new Set([
    ...(teams || []).map((team) => String(team.sectionId || "")),
    ...(studentStates || []).map((student) => String(student.sectionId || "")),
  ].filter(Boolean))];
  if (sectionIds.length !== 1) {
    throw new AppError(400, "ASSIGNMENTS_MUST_SHARE_SECTION", "Guarda los estados de una sola sección a la vez.");
  }
  return sectionIds[0];
}

module.exports = {
  STUDENT_ASSIGNMENT_STATUSES,
  assertTeacherProjectAccess,
  getAssignmentSectionId,
  getTeamSectionId,
  validateRosterAssignments,
  validateStudentAssignmentUpdate,
  validateStudentStates,
  validateTeamAssignmentInput,
  validateTeamInput,
};
