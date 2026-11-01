const crypto = require("node:crypto");
const { AppError } = require("../lib/http");
const { ACTION_LABELS, validId, assertCompatibleStudentSections } = require("../lib/academicManagement");
const { sql, getPool, withTransaction } = require("../lib/db");
const { writeAudit } = require("../lib/audit");

const sameId = (left, right) => String(left || "").toLowerCase() === String(right || "").toLowerCase();
const requestFor = (connection) => new sql.Request(connection);
const sectionLabel = (section) => `${section.subjectCode} / ${section.code} · ${section.campusName} · ${section.period}`;

async function assertAuditAvailable(connection) {
  const result = await requestFor(connection).query(`SELECT OBJECT_ID('vcm.Auditoria', 'U') AS auditTable;`);
  if (!result.recordset[0]?.auditTable) throw new AppError(503, "AUDIT_REQUIRED", "La auditoría no está disponible. No se pueden guardar ajustes académicos.");
}

async function managementCatalogs() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CONVERT(varchar(36), sede_id) AS id, nombre AS name FROM vcm.Sede WHERE activa = 1 ORDER BY nombre;
    SELECT codigo AS code FROM vcm.PeriodoAcademico ORDER BY codigo DESC;
  `);
  return { campuses: result.recordsets[0], periods: result.recordsets[1] };
}

async function searchManagementSections(filters = {}) {
  const pool = await getPool();
  const campusId = filters.campusId ? validId(filters.campusId, "La sede") : null;
  const result = await pool.request()
    .input("pattern", sql.NVarChar(202), `%${String(filters.query || "").trim().slice(0, 200)}%`)
    .input("campusId", sql.UniqueIdentifier, campusId)
    .input("period", sql.VarChar(20), String(filters.period || "").slice(0, 20) || null)
    .query(`
      SELECT TOP (100) CONVERT(varchar(36), section.seccion_id) AS id,
        section.codigo AS code, subject.codigo AS subjectCode, subject.nombre AS subjectName,
        campus.nombre AS campusName, period.codigo AS period, COUNT(*) OVER() AS total
      FROM vcm.Seccion section
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id
      WHERE section.activa = 1 AND subject.activa = 1 AND campus.activa = 1
        AND (@campusId IS NULL OR section.sede_id = @campusId)
        AND (@period IS NULL OR period.codigo = @period)
        AND (section.codigo LIKE @pattern OR subject.codigo LIKE @pattern OR subject.nombre LIKE @pattern OR campus.nombre LIKE @pattern)
      ORDER BY period.codigo DESC, campus.nombre, subject.codigo, section.codigo;
    `);
  return { records: result.recordset, total: result.recordset[0]?.total || 0 };
}

async function searchManagementPeople(entity, query = "") {
  const pool = await getPool();
  const request = pool.request()
    .input("pattern", sql.NVarChar(202), `%${String(query).trim().slice(0, 200)}%`)
    .input("normalized", sql.NVarChar(202), `%${String(query).replace(/[.\-\s]/g, "").slice(0, 200)}%`);
  if (entity === "teachers") {
    const result = await request.query(`
      SELECT CONVERT(varchar(36), teacher.docente_id) AS id,
        teacher.nombre AS name, teacher.identificador_fuente AS sourceId, teacher.correo AS email,
        CASE WHEN usr.activo = 1 AND usr.rol IN ('TEACHER', 'COORDINATOR') AND usr.password_hash IS NOT NULL
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS accountReady
      FROM vcm.Docente teacher
      LEFT JOIN vcm.Usuario usr ON usr.usuario_id = teacher.usuario_id
        OR (teacher.usuario_id IS NULL AND LOWER(usr.correo) = LOWER(teacher.correo))
      WHERE teacher.activo = 1 AND (teacher.nombre LIKE @pattern OR teacher.correo LIKE @pattern
        OR REPLACE(REPLACE(REPLACE(teacher.identificador_fuente, '.', ''), '-', ''), ' ', '') LIKE @normalized)
      ORDER BY teacher.nombre, teacher.docente_id;
    `);
    return result.recordset;
  }
  const result = await request.query(`
    SELECT TOP (50) CONVERT(varchar(36), alumno_id) AS id, nombre_completo AS name, rut
    FROM vcm.Alumno
    WHERE activo = 1 AND (nombre_completo LIKE @pattern OR REPLACE(REPLACE(REPLACE(rut, '.', ''), '-', ''), ' ', '') LIKE @normalized)
    ORDER BY nombre_completo, alumno_id;
  `);
  return result.recordset;
}

async function sectionContext(connection, sectionId, lock = false) {
  const result = await requestFor(connection).input("sectionId", sql.UniqueIdentifier, sectionId).query(`
    SELECT CONVERT(varchar(36), section.seccion_id) AS id, section.codigo AS code,
      CONVERT(varchar(36), section.asignatura_id) AS subjectId, subject.codigo AS subjectCode,
      subject.nombre AS subjectName, campus.nombre AS campusName, period.codigo AS period,
      section.activa AS active, subject.activa AS subjectActive, campus.activa AS campusActive
    FROM vcm.Seccion section ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
    INNER JOIN vcm.Asignatura subject ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""} ON subject.asignatura_id = section.asignatura_id
    INNER JOIN vcm.Sede campus ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""} ON campus.sede_id = section.sede_id
    INNER JOIN vcm.PeriodoAcademico period ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""} ON period.periodo_academico_id = section.periodo_academico_id
    WHERE section.seccion_id = @sectionId;

    SELECT CONVERT(varchar(36), project.proyecto_id) AS id, project.codigo_publico AS code,
      project.nombre AS name, project.estado AS status, milestone.estado AS closingStatus
    FROM vcm.ProyectoSeccion link ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
    INNER JOIN vcm.Proyecto project ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""} ON project.proyecto_id = link.proyecto_id
    LEFT JOIN vcm.HitoProyectoSeccion milestone ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      ON milestone.proyecto_id = link.proyecto_id AND milestone.seccion_id = link.seccion_id AND milestone.numero = 3
    WHERE link.seccion_id = @sectionId ORDER BY project.proyecto_id;
  `);
  const section = result.recordsets[0][0];
  if (!section) throw new AppError(404, "SECTION_NOT_FOUND", "No se encontró la sección.");
  return { ...section, projects: result.recordsets[1] };
}

function assertEditableSection(section) {
  if (!section.active || !section.subjectActive || !section.campusActive) {
    throw new AppError(409, "INACTIVE_SECTION", "La sección, asignatura o sede no está activa.");
  }
  const closed = section.projects.find((project) => ["FINALIZADO", "CANCELADO"].includes(project.status) || project.closingStatus === "COMPLETADO");
  if (closed) throw new AppError(409, "SECTION_ADJUSTMENT_LOCKED", `La sección está cerrada en ${closed.code}. No puede modificarse desde este panel.`);
}

async function managementSectionDetail(sectionId) {
  const pool = await getPool();
  const section = await sectionContext(pool, sectionId);
  let lockedReason = "";
  try { assertEditableSection(section); } catch (error) { lockedReason = error.message; }
  const result = await pool.request().input("sectionId", sql.UniqueIdentifier, sectionId).query(`
    SELECT CONVERT(varchar(36), teacher.docente_id) AS id, teacher.nombre AS name,
      teacher.identificador_fuente AS sourceId, teacher.correo AS email, teacher.activo AS active
    FROM vcm.DocenteSeccion assignment
    INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id
    WHERE assignment.seccion_id = @sectionId AND assignment.vigente = 1 ORDER BY teacher.nombre, teacher.docente_id;
    SELECT CONVERT(varchar(36), student.alumno_id) AS id, student.nombre_completo AS name, student.rut
    FROM vcm.Matricula enrollment
    INNER JOIN vcm.Alumno student ON student.alumno_id = enrollment.alumno_id
    WHERE enrollment.seccion_id = @sectionId AND enrollment.vigente = 1 AND student.activo = 1
    ORDER BY student.nombre_completo, student.alumno_id;
  `);
  return { section, teachers: result.recordsets[0], students: result.recordsets[1], lockedReason };
}

async function getTeacher(connection, teacherId) {
  const result = await requestFor(connection).input("teacherId", sql.UniqueIdentifier, teacherId).query(`
    SELECT CONVERT(varchar(36), teacher.docente_id) AS id, teacher.nombre AS name,
      teacher.activo AS active, teacher.identificador_fuente AS sourceId,
      CASE WHEN usr.activo = 1 AND usr.rol IN ('TEACHER', 'COORDINATOR') AND usr.password_hash IS NOT NULL
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS accountReady
    FROM vcm.Docente teacher WITH (UPDLOCK, HOLDLOCK)
    LEFT JOIN vcm.Usuario usr WITH (UPDLOCK, HOLDLOCK) ON usr.usuario_id = teacher.usuario_id
      OR (teacher.usuario_id IS NULL AND LOWER(usr.correo) = LOWER(teacher.correo))
    WHERE teacher.docente_id = @teacherId;
  `);
  if (!result.recordset[0]) throw new AppError(404, "TEACHER_NOT_FOUND", "No se encontró el profesor.");
  return result.recordset[0];
}

async function teacherAssigned(connection, sectionId, teacherId) {
  const result = await requestFor(connection)
    .input("sectionId", sql.UniqueIdentifier, sectionId).input("teacherId", sql.UniqueIdentifier, teacherId).query(`
      SELECT vigente AS active FROM vcm.DocenteSeccion WITH (UPDLOCK, HOLDLOCK)
      WHERE seccion_id = @sectionId AND docente_id = @teacherId;
    `);
  return Boolean(result.recordset[0]?.active);
}

function assertTeacherReady(teacher) {
  if (!teacher.active || !teacher.accountReady) {
    throw new AppError(409, "TEACHER_ACCOUNT_REQUIRED", `${teacher.name} necesita un registro activo y una cuenta docente habilitada. Revísala en Usuarios antes de asignarlo.`);
  }
}

async function getStudent(connection, input) {
  const request = requestFor(connection).input("studentId", sql.UniqueIdentifier, input.studentId || null)
    .input("rut", sql.VarChar(20), input.rut || null);
  const result = await request.query(`
    SELECT CONVERT(varchar(36), alumno_id) AS id, nombre_completo AS name, rut, activo AS active
    FROM vcm.Alumno WITH (UPDLOCK, HOLDLOCK)
    WHERE (@studentId IS NOT NULL AND alumno_id = @studentId)
      OR (@rut IS NOT NULL AND UPPER(REPLACE(REPLACE(REPLACE(rut, '.', ''), '-', ''), ' ', '')) = @rut);
  `);
  if (result.recordset.length > 1) throw new AppError(409, "DUPLICATE_STUDENT_RUT", "Hay más de un alumno con ese RUT. Revisa los registros antes de continuar.");
  const student = result.recordset[0];
  if (!student && input.action !== "STUDENT_ADD") throw new AppError(404, "STUDENT_NOT_FOUND", "No se encontró el alumno.");
  if (student && !student.active) throw new AppError(409, "INACTIVE_STUDENT", "El alumno está desactivado. Revisa su registro académico antes de matricularlo.");
  if (student && input.action === "STUDENT_ADD" && student.name.localeCompare(input.name, "es", { sensitivity: "base" }) !== 0) {
    throw new AppError(409, "STUDENT_NAME_CONFLICT", `Ese RUT ya pertenece a ${student.name}. Usa Matricular alumno existente; este panel no renombra personas.`);
  }
  return student || { id: null, name: input.name, rut: input.rut, active: true };
}

async function enrollmentFor(connection, studentId, subjectId) {
  if (!studentId) return null;
  const result = await requestFor(connection).input("studentId", sql.UniqueIdentifier, studentId)
    .input("subjectId", sql.UniqueIdentifier, subjectId).query(`
      SELECT CONVERT(varchar(36), matricula_id) AS id, CONVERT(varchar(36), seccion_id) AS sectionId, vigente AS active
      FROM vcm.Matricula WITH (UPDLOCK, HOLDLOCK) WHERE alumno_id = @studentId AND asignatura_id = @subjectId;
    `);
  return result.recordset[0] || null;
}

async function studentActivity(connection, studentId, sourceId, targetId) {
  if (!studentId) return { teams: [], states: [] };
  const result = await requestFor(connection).input("studentId", sql.UniqueIdentifier, studentId)
    .input("sourceId", sql.UniqueIdentifier, sourceId || null).input("targetId", sql.UniqueIdentifier, targetId || null).query(`
      SELECT CONVERT(varchar(36), team.proyecto_id) AS projectId,
        CONVERT(varchar(36), team.equipo_id) AS teamId, team.nombre AS teamName,
        CONVERT(varchar(36), team.seccion_id) AS sectionId
      FROM vcm.EquipoAlumno membership WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN vcm.Equipo team WITH (UPDLOCK, HOLDLOCK) ON team.equipo_id = membership.equipo_id
      WHERE membership.alumno_id = @studentId AND team.seccion_id IN (@sourceId, @targetId)
      ORDER BY team.proyecto_id, team.equipo_id;
      SELECT CONVERT(varchar(36), estado.proyecto_id) AS projectId,
        CONVERT(varchar(36), estado.seccion_id) AS sectionId, estado.estado AS status
      FROM vcm.ProyectoAlumnoEstado estado WITH (UPDLOCK, HOLDLOCK)
      WHERE estado.alumno_id = @studentId AND estado.seccion_id IN (@sourceId, @targetId)
      ORDER BY estado.proyecto_id;
    `);
  return { teams: result.recordsets[0], states: result.recordsets[1] };
}

async function prepareAdjustment(connection, input) {
  const contexts = new Map();
  for (const id of [...new Set([input.sectionId, input.targetSectionId].filter(Boolean))].sort()) {
    const context = await sectionContext(connection, id, true);
    assertEditableSection(context);
    contexts.set(id, context);
  }
  const section = contexts.get(input.sectionId);
  const target = contexts.get(input.targetSectionId);
  const changes = [];
  const warnings = ["Actualiza también el archivo de carga académica: una futura importación puede sobrescribir estos ajustes."];
  const context = { section, target: target || null, teachers: [], students: [] };

  if (input.action.startsWith("TEACHER_")) {
    const teacher = await getTeacher(connection, input.teacherId);
    const assigned = await teacherAssigned(connection, section.id, teacher.id);
    context.teachers.push(teacher);
    if (input.action === "TEACHER_ASSIGN" || input.action === "TEACHER_REPLACE") {
      assertTeacherReady(teacher);
      if (assigned) throw new AppError(409, "TEACHER_ALREADY_ASSIGNED", "El profesor entrante ya está asignado a esa sección.");
    } else if (!assigned) throw new AppError(409, "TEACHER_ASSIGNMENT_CHANGED", "El profesor ya no está asignado a la sección seleccionada.");
    if (input.action === "TEACHER_ASSIGN") changes.push({ person: teacher.name, from: "Sin asignación en esta sección", to: sectionLabel(section) });
    if (input.action === "TEACHER_REMOVE") {
      const result = await requestFor(connection).input("sectionId", sql.UniqueIdentifier, section.id).input("teacherId", sql.UniqueIdentifier, teacher.id).query(`
        SELECT COUNT(*) AS total FROM vcm.DocenteSeccion assignment WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
        INNER JOIN vcm.Usuario usr ON usr.usuario_id = teacher.usuario_id
          OR (teacher.usuario_id IS NULL AND LOWER(usr.correo) = LOWER(teacher.correo))
        WHERE assignment.seccion_id = @sectionId AND assignment.vigente = 1 AND assignment.docente_id <> @teacherId
          AND usr.activo = 1 AND usr.rol IN ('TEACHER', 'COORDINATOR') AND usr.password_hash IS NOT NULL;
      `);
      if (result.recordset[0].total === 0 && section.projects.length) throw new AppError(409, "LAST_PROJECT_TEACHER", "Es el único profesor habilitado de una sección con proyectos. Usa Reemplazar profesor para no dejarla sin responsable.");
      changes.push({ person: teacher.name, from: sectionLabel(section), to: "Asignación desactivada; cuenta y otras secciones conservadas" });
    }
    if (input.action === "TEACHER_REPLACE") {
      const previous = await getTeacher(connection, input.previousTeacherId);
      if (!await teacherAssigned(connection, section.id, previous.id)) throw new AppError(409, "TEACHER_ASSIGNMENT_CHANGED", "El profesor saliente ya no está asignado a esta sección.");
      context.teachers.push(previous);
      changes.push({ person: previous.name, from: sectionLabel(section), to: "Asignación desactivada" });
      changes.push({ person: teacher.name, from: "Profesor entrante", to: sectionLabel(section) });
    }
    if (input.action === "TEACHER_SWAP") {
      if (section.period !== target.period) throw new AppError(409, "INCOMPATIBLE_TEACHER_PERIODS", "El intercambio de profesores requiere secciones del mismo período.");
      const other = await getTeacher(connection, input.otherTeacherId);
      assertTeacherReady(teacher); assertTeacherReady(other);
      if (!await teacherAssigned(connection, target.id, other.id)
        || await teacherAssigned(connection, target.id, teacher.id)
        || await teacherAssigned(connection, section.id, other.id)) {
        throw new AppError(409, "TEACHER_SWAP_CONFLICT", "Revisa las asignaciones: uno de los profesores ya está en el destino o no pertenece al origen indicado.");
      }
      context.teachers.push(other);
      changes.push({ person: teacher.name, from: sectionLabel(section), to: sectionLabel(target) });
      changes.push({ person: other.name, from: sectionLabel(target), to: sectionLabel(section) });
    }
    warnings.push("Los profesores entrantes verán las secciones asignadas y continuarán con los proyectos y avances actuales. Se conserva la autoría histórica.");
  } else {
    if (target) assertCompatibleStudentSections(section, target);
    const student = await getStudent(connection, input);
    const enrollment = await enrollmentFor(connection, student.id, section.subjectId);
    let source = null;
    const enrolling = ["STUDENT_ADD", "STUDENT_ENROLL"].includes(input.action);
    if (enrolling && enrollment?.active) throw new AppError(409, "STUDENT_ALREADY_ENROLLED", "El alumno ya tiene matrícula vigente en esta asignatura. Usa Trasladar alumno si corresponde.");
    if (!enrolling && (!enrollment?.active || !sameId(enrollment.sectionId, section.id))) {
      throw new AppError(409, "STUDENT_ENROLLMENT_CHANGED", "El alumno ya no pertenece a la sección de origen indicada.");
    }
    if (enrollment) {
      source = contexts.get(String(enrollment.sectionId).toLowerCase()) || await sectionContext(connection, enrollment.sectionId, true);
      assertEditableSection(source);
      assertCompatibleStudentSections(source, section);
    }
    const destination = enrolling ? section : (target || null);
    const activity = await studentActivity(connection, student.id, source?.id, destination?.id);
    context.students.push({ student, enrollment, source, destination, activity });
    changes.push({ person: `${student.name} · ${student.rut}`, from: source ? sectionLabel(source) : "Sin matrícula en esta asignatura",
      to: destination ? sectionLabel(destination) : "Matrícula desactivada; alumno conservado" });
    if (input.action === "STUDENT_SWAP") {
      const other = await getStudent(connection, { action: input.action, studentId: input.otherStudentId });
      const otherEnrollment = await enrollmentFor(connection, other.id, section.subjectId);
      if (!otherEnrollment?.active || !sameId(otherEnrollment.sectionId, target.id)) throw new AppError(409, "STUDENT_ENROLLMENT_CHANGED", "El otro alumno ya no pertenece a la segunda sección.");
      const otherActivity = await studentActivity(connection, other.id, target.id, section.id);
      context.students.push({ student: other, enrollment: otherEnrollment, source: target, destination: section, activity: otherActivity });
      changes.push({ person: `${other.name} · ${other.rut}`, from: sectionLabel(target), to: sectionLabel(section) });
    }
    const teamCount = context.students.reduce((total, item) => total + item.activity.teams.length, 0);
    warnings.push(`${teamCount} vinculación(es) a equipos se retirarán. Los equipos y su historial no se borran; las vinculaciones y estados anteriores quedan en auditoría.`);
    warnings.push("Los alumnos ingresan sin equipo en el destino. No se trasladan archivos, entregas, avances ni hitos; el docente deberá revisar su asignación a equipos.");
  }
  const { previewVersion: _version, confirmationCode: _confirmation, ...versionInput } = input;
  const version = crypto.createHash("sha256").update(JSON.stringify({ input: versionInput, context })).digest("hex");
  return { context, plan: { title: ACTION_LABELS[input.action], action: input.action, changes, warnings, reason: input.reason,
    confirmationCode: section.code, version } };
}

async function setTeacherAssignment(connection, teacherId, sectionId, active) {
  const request = requestFor(connection).input("teacherId", sql.UniqueIdentifier, teacherId).input("sectionId", sql.UniqueIdentifier, sectionId);
  if (active) {
    await request.query(`
      MERGE vcm.DocenteSeccion WITH (HOLDLOCK) AS target
      USING (SELECT @teacherId AS teacherId, @sectionId AS sectionId) AS source
      ON target.docente_id = source.teacherId AND target.seccion_id = source.sectionId
      WHEN MATCHED THEN UPDATE SET vigente = 1, asignado_en = SYSUTCDATETIME(), carga_academica_id = NULL
      WHEN NOT MATCHED THEN INSERT (docente_id, seccion_id, vigente) VALUES (@teacherId, @sectionId, 1);
    `);
  } else {
    const result = await request.query(`
      UPDATE vcm.DocenteSeccion SET vigente = 0 WHERE docente_id = @teacherId AND seccion_id = @sectionId AND vigente = 1;
      SELECT @@ROWCOUNT AS affected;
    `);
    if (result.recordset[0].affected !== 1) throw new AppError(409, "TEACHER_ASSIGNMENT_CHANGED", "La asignación docente cambió. Revisa nuevamente la vista previa.");
  }
}

async function applyStudentChange(connection, item, actorId) {
  let studentId = item.student.id;
  if (!studentId) {
    const result = await requestFor(connection).input("name", sql.NVarChar(180), item.student.name).input("rut", sql.VarChar(20), item.student.rut).query(`
      INSERT INTO vcm.Alumno (rut, nombre_completo, identificador_externo, activo)
      OUTPUT CONVERT(varchar(36), inserted.alumno_id) AS id
      VALUES (@rut, @name, CONCAT(N'MANUAL-', @rut), 1);
    `);
    studentId = result.recordset[0].id;
  }
  if (item.enrollment) {
    const result = await requestFor(connection).input("enrollmentId", sql.UniqueIdentifier, item.enrollment.id)
      .input("sourceId", sql.UniqueIdentifier, item.enrollment.sectionId).input("expectedActive", sql.Bit, item.enrollment.active)
      .input("targetId", sql.UniqueIdentifier, item.destination?.id || item.enrollment.sectionId)
      .input("active", sql.Bit, Boolean(item.destination)).query(`
        UPDATE vcm.Matricula SET seccion_id = @targetId, vigente = @active, carga_academica_id = NULL,
          matriculado_en = CASE WHEN @active = 1 THEN SYSUTCDATETIME() ELSE matriculado_en END
        WHERE matricula_id = @enrollmentId AND seccion_id = @sourceId AND vigente = @expectedActive;
        SELECT @@ROWCOUNT AS affected;
      `);
    if (result.recordset[0].affected !== 1) throw new AppError(409, "STUDENT_ENROLLMENT_CHANGED", "La matrícula cambió. Se canceló toda la operación.");
  } else {
    await requestFor(connection).input("studentId", sql.UniqueIdentifier, studentId)
      .input("subjectId", sql.UniqueIdentifier, item.destination.subjectId).input("targetId", sql.UniqueIdentifier, item.destination.id).query(`
        INSERT INTO vcm.Matricula (alumno_id, asignatura_id, seccion_id, vigente) VALUES (@studentId, @subjectId, @targetId, 1);
      `);
  }
  await requestFor(connection).input("studentId", sql.UniqueIdentifier, studentId)
    .input("sourceId", sql.UniqueIdentifier, item.source?.id || null).input("targetId", sql.UniqueIdentifier, item.destination?.id || null)
    .input("actorId", sql.UniqueIdentifier, actorId).query(`
      DELETE membership FROM vcm.EquipoAlumno membership
      INNER JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id
      WHERE membership.alumno_id = @studentId AND team.seccion_id IN (@sourceId, @targetId);
      UPDATE vcm.ProyectoAlumnoEstado SET estado = 'SIN_EQUIPO', actualizado_por_usuario_id = @actorId,
        actualizado_en = SYSUTCDATETIME() WHERE alumno_id = @studentId AND seccion_id = @sourceId;
      MERGE vcm.ProyectoAlumnoEstado WITH (HOLDLOCK) AS target
      USING (SELECT proyecto_id, seccion_id FROM vcm.ProyectoSeccion WHERE seccion_id = @targetId) AS source
      ON target.proyecto_id = source.proyecto_id AND target.alumno_id = @studentId
      WHEN MATCHED THEN UPDATE SET seccion_id = source.seccion_id, estado = 'SIN_EQUIPO',
        actualizado_por_usuario_id = @actorId, actualizado_en = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (proyecto_id, seccion_id, alumno_id, estado, actualizado_por_usuario_id)
        VALUES (source.proyecto_id, source.seccion_id, @studentId, 'SIN_EQUIPO', @actorId);
    `);
  return studentId;
}

async function executeAcademicAdjustment(input, principal, preview = false) {
  try {
    return await withTransaction(async (transaction) => {
      await assertAuditAvailable(transaction);
      const { context, plan } = await prepareAdjustment(transaction, input);
      if (preview) return plan;
      if (input.confirmationCode !== plan.confirmationCode) throw new AppError(400, "WRONG_SECTION_CONFIRMATION", "El código escrito no coincide con la sección principal.");
      if (input.previewVersion !== plan.version) throw new AppError(409, "ADJUSTMENT_PREVIEW_STALE", "Los datos cambiaron desde la vista previa. Revísalos y confirma otra vez.");
      const { section, target } = context;
      switch (input.action) {
        case "TEACHER_ASSIGN": await setTeacherAssignment(transaction, input.teacherId, section.id, true); break;
        case "TEACHER_REMOVE": await setTeacherAssignment(transaction, input.teacherId, section.id, false); break;
        case "TEACHER_REPLACE":
          await setTeacherAssignment(transaction, input.previousTeacherId, section.id, false);
          await setTeacherAssignment(transaction, input.teacherId, section.id, true); break;
        case "TEACHER_SWAP":
          await setTeacherAssignment(transaction, input.teacherId, section.id, false);
          await setTeacherAssignment(transaction, input.otherTeacherId, target.id, false);
          await setTeacherAssignment(transaction, input.teacherId, target.id, true);
          await setTeacherAssignment(transaction, input.otherTeacherId, section.id, true); break;
        default:
          for (const item of context.students) item.appliedStudentId = await applyStudentChange(transaction, item, principal.id);
      }
      await writeAudit(transaction, principal, {
        action: "ACADEMIC_ADJUSTMENT", entity: "Seccion", entityId: section.id,
        description: `${plan.title}: ${sectionLabel(section)}.`,
        data: { operation: input.action, reason: input.reason, changes: plan.changes, before: context, previewVersion: plan.version },
      });
      return { applied: true, title: plan.title };
    });
  } catch (error) {
    if ([2601, 2627, 1205].includes(error.number)) throw new AppError(409, "ACADEMIC_ADJUSTMENT_CONFLICT", "Los datos cambiaron o existe un registro duplicado. No se guardó ningún cambio; vuelve a revisar la vista previa.");
    throw error;
  }
}

async function registerManagementTeacher(input, principal) {
  try {
    return await withTransaction(async (transaction) => {
      await assertAuditAvailable(transaction);
      const duplicates = await requestFor(transaction).input("sourceId", sql.NVarChar(200), input.sourceId)
        .input("email", sql.NVarChar(320), input.email).query(`
          SELECT docente_id FROM vcm.Docente WITH (UPDLOCK, HOLDLOCK)
          WHERE UPPER(REPLACE(REPLACE(REPLACE(identificador_fuente, '.', ''), '-', ''), ' ', '')) = @sourceId OR LOWER(correo) = @email;
          SELECT CONVERT(varchar(36), usuario_id) AS id, rol AS role FROM vcm.Usuario WITH (UPDLOCK, HOLDLOCK) WHERE LOWER(correo) = @email;
        `);
      if (duplicates.recordsets[0].length) throw new AppError(409, "TEACHER_ALREADY_EXISTS", "Ya existe un profesor con ese código o correo. Busca el registro existente.");
      const user = duplicates.recordsets[1][0];
      if (user && !["TEACHER", "COORDINATOR"].includes(user.role)) throw new AppError(409, "TEACHER_ACCOUNT_CONFLICT", "Ese correo pertenece a una cuenta que no permite docencia.");
      if (user) {
        const linked = await requestFor(transaction).input("userId", sql.UniqueIdentifier, user.id).query(`
          SELECT docente_id FROM vcm.Docente WITH (UPDLOCK, HOLDLOCK) WHERE usuario_id = @userId;
        `);
        if (linked.recordset.length) throw new AppError(409, "TEACHER_ACCOUNT_CONFLICT", "La cuenta ya está vinculada a otro profesor.");
      }
      const result = await requestFor(transaction).input("sourceId", sql.NVarChar(200), input.sourceId)
        .input("name", sql.NVarChar(180), input.name).input("email", sql.NVarChar(320), input.email)
        .input("userId", sql.UniqueIdentifier, user?.id || null).query(`
          INSERT INTO vcm.Docente (identificador_fuente, nombre, correo, usuario_id, activo)
          OUTPUT CONVERT(varchar(36), inserted.docente_id) AS id
          VALUES (@sourceId, @name, @email, @userId, 1);
        `);
      await writeAudit(transaction, principal, { action: "ACADEMIC_TEACHER_CREATED", entity: "Docente", entityId: result.recordset[0].id,
        description: `Profesor registrado manualmente: ${input.name}.`, data: { ...input, userId: user?.id || null } });
      return { id: result.recordset[0].id, needsAccount: !user };
    });
  } catch (error) {
    if ([2601, 2627].includes(error.number)) throw new AppError(409, "TEACHER_ALREADY_EXISTS", "El código o la cuenta ya están vinculados. No se creó ningún registro.");
    throw error;
  }
}

module.exports = { managementCatalogs, searchManagementSections, searchManagementPeople, managementSectionDetail,
  executeAcademicAdjustment, registerManagementTeacher, assertEditableSection, assertTeacherReady };
