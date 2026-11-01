const { AppError } = require("../lib/http");
const { currentDateInChile } = require("../lib/coordinationMonitoring");
const { assertControlAccess, buildDataQualityReport, buildNotifications, normalizeControlFilters } = require("../lib/controlCenter");
const { sql, getPool } = require("../lib/db");
const { listCoordinationMonitoring } = require("./coordinationMonitoringRepository");

async function queryDataQualityRows(pool) {
  const [unlinkedTeachers, sectionsWithoutTeachers, sectionsWithoutStudents, incompleteTeams, teacherAccountsWithoutAssignments, invalidMemberships] = await Promise.all([
    pool.request().query(`
      SELECT CONVERT(varchar(36), teacher.docente_id) AS id, teacher.nombre AS name,
        teacher.correo AS email, COUNT(DISTINCT assignment.seccion_id) AS sections
      FROM vcm.Docente teacher
      INNER JOIN vcm.DocenteSeccion assignment ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
      LEFT JOIN vcm.Usuario usr ON usr.usuario_id = teacher.usuario_id AND usr.activo = 1
      WHERE teacher.activo = 1 AND usr.usuario_id IS NULL
      GROUP BY teacher.docente_id, teacher.nombre, teacher.correo
      ORDER BY teacher.nombre;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), section.seccion_id) AS id, project.codigo_publico AS projectCode,
        subject.codigo AS subjectCode, section.codigo AS sectionCode, campus.nombre AS campusName
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id AND project.estado <> 'CANCELADO'
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id AND section.activa = 1
      INNER JOIN vcm.HitoProyectoSeccion milestoneOne
        ON milestoneOne.proyecto_id = project.proyecto_id
        AND milestoneOne.seccion_id = section.seccion_id AND milestoneOne.numero = 1
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      WHERE NOT EXISTS (
        SELECT 1 FROM vcm.DocenteSeccion assignment
        INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id AND teacher.activo = 1
        WHERE assignment.seccion_id = section.seccion_id AND assignment.vigente = 1
      )
      ORDER BY project.codigo_publico, campus.nombre, section.codigo;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), section.seccion_id) AS id, project.codigo_publico AS projectCode,
        subject.codigo AS subjectCode, section.codigo AS sectionCode, campus.nombre AS campusName
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id AND project.estado <> 'CANCELADO'
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id AND section.activa = 1
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      WHERE NOT EXISTS (
        SELECT 1 FROM vcm.Matricula enrollment
        INNER JOIN vcm.Alumno student ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
        WHERE enrollment.seccion_id = section.seccion_id AND enrollment.vigente = 1
      )
      ORDER BY project.codigo_publico, campus.nombre, section.codigo;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), section.seccion_id) AS id, CONVERT(varchar(36), section.seccion_id) AS sectionId,
        project.codigo_publico AS projectCode, section.codigo AS sectionCode,
        studentSummary.total AS students, teamSummary.assignedStudents, teamSummary.teams
      FROM vcm.ProyectoSeccion projectSection
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id AND project.estado <> 'CANCELADO'
      INNER JOIN vcm.Seccion section ON section.seccion_id = projectSection.seccion_id AND section.activa = 1
      INNER JOIN vcm.HitoProyectoSeccion milestoneOne
        ON milestoneOne.proyecto_id = project.proyecto_id
        AND milestoneOne.seccion_id = section.seccion_id AND milestoneOne.numero = 1
      OUTER APPLY (
        SELECT COUNT(*) AS total FROM vcm.Matricula enrollment
        INNER JOIN vcm.Alumno student ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
        WHERE enrollment.seccion_id = section.seccion_id AND enrollment.vigente = 1
      ) studentSummary
      OUTER APPLY (
        SELECT COUNT(DISTINCT team.equipo_id) AS teams, COUNT(DISTINCT membership.alumno_id) AS assignedStudents
        FROM vcm.Equipo team
        LEFT JOIN vcm.EquipoAlumno membership ON membership.equipo_id = team.equipo_id
        WHERE team.proyecto_id = project.proyecto_id AND team.seccion_id = section.seccion_id
      ) teamSummary
      WHERE milestoneOne.estado <> 'COMPLETADO'
        AND teamSummary.teams > 0 AND teamSummary.assignedStudents < studentSummary.total
      ORDER BY project.codigo_publico, section.codigo;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), usr.usuario_id) AS id, usr.nombre AS name, usr.correo AS email
      FROM vcm.Usuario usr
      WHERE usr.activo = 1 AND usr.rol = 'TEACHER'
        AND NOT EXISTS (
          SELECT 1 FROM vcm.Docente teacher
          INNER JOIN vcm.DocenteSeccion assignment ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
          WHERE teacher.activo = 1 AND teacher.usuario_id = usr.usuario_id
        )
      ORDER BY usr.nombre;
    `),
    pool.request().query(`
      SELECT CONVERT(varchar(36), membership.equipo_id) + ':' + CONVERT(varchar(36), membership.alumno_id) AS id,
        CONVERT(varchar(36), section.seccion_id) AS sectionId, project.codigo_publico AS projectCode,
        section.codigo AS sectionCode, student.nombre_completo AS studentName
      FROM vcm.EquipoAlumno membership
      INNER JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = team.proyecto_id
      INNER JOIN vcm.Seccion section ON section.seccion_id = team.seccion_id
      INNER JOIN vcm.Alumno student ON student.alumno_id = membership.alumno_id
      WHERE membership.proyecto_id <> team.proyecto_id OR NOT EXISTS (
        SELECT 1 FROM vcm.Matricula enrollment
        WHERE enrollment.alumno_id = membership.alumno_id AND enrollment.seccion_id = team.seccion_id AND enrollment.vigente = 1
      )
      ORDER BY project.codigo_publico, section.codigo, student.nombre_completo;
    `),
  ]);
  return {
    unlinkedTeachers: unlinkedTeachers.recordset,
    sectionsWithoutTeachers: sectionsWithoutTeachers.recordset,
    sectionsWithoutStudents: sectionsWithoutStudents.recordset,
    incompleteTeams: incompleteTeams.recordset,
    teacherAccountsWithoutAssignments: teacherAccountsWithoutAssignments.recordset,
    invalidMemberships: invalidMemberships.recordset,
  };
}

async function getDataQuality(principal) {
  assertControlAccess(principal);
  const pool = await getPool();
  return buildDataQualityReport(await queryDataQualityRows(pool));
}

async function listControlAudit(input, principal) {
  assertControlAccess(principal);
  const filters = normalizeControlFilters(input);
  const pool = await getPool();
  const request = pool.request()
    .input("pattern", sql.NVarChar(240), `%${filters.query}%`)
    .input("action", sql.VarChar(60), filters.action)
    .input("entity", sql.VarChar(60), filters.entity)
    .input("offset", sql.Int, (filters.page - 1) * filters.pageSize)
    .input("pageSize", sql.Int, filters.pageSize);
  const [events, actions, entities] = await Promise.all([
    request.query(`
      SELECT COUNT(*) OVER() AS filteredTotal, CONVERT(varchar(30), audit.auditoria_id) AS id,
        COALESCE(usr.nombre, audit.usuario_correo) AS actorName, audit.usuario_correo AS actorEmail,
        LOWER(COALESCE(usr.rol, 'SYSTEM')) AS actorRole, audit.accion AS action,
        audit.entidad AS entity, audit.entidad_id AS entityId, audit.descripcion AS description,
        audit.creado_en AS createdAt
      FROM vcm.Auditoria audit
      LEFT JOIN vcm.Usuario usr ON usr.usuario_id = audit.usuario_id
      WHERE (@action = 'all' OR audit.accion = @action)
        AND (@entity = 'all' OR audit.entidad = @entity)
        AND (audit.usuario_correo LIKE @pattern OR COALESCE(usr.nombre, '') LIKE @pattern
          OR audit.accion LIKE @pattern OR audit.entidad LIKE @pattern OR audit.descripcion LIKE @pattern)
      ORDER BY audit.creado_en DESC, audit.auditoria_id DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
    `),
    pool.request().query("SELECT DISTINCT accion AS value FROM vcm.Auditoria ORDER BY accion;"),
    pool.request().query("SELECT DISTINCT entidad AS value FROM vcm.Auditoria ORDER BY entidad;"),
  ]);
  const records = events.recordset.map((record) => {
    const output = { ...record };
    delete output.filteredTotal;
    return output;
  });
  return {
    records,
    total: events.recordset[0]?.filteredTotal || 0,
    page: filters.page,
    pageSize: filters.pageSize,
    filters: { query: filters.query, action: filters.action, entity: filters.entity },
    facets: { actions: actions.recordset.map((row) => row.value), entities: entities.recordset.map((row) => row.value) },
  };
}

async function listTeachingNotificationRows(pool, principal) {
  if (!(principal.role === "teacher" || principal.canTeach)) return [];
  const currentDate = currentDateInChile();
  const result = await pool.request()
    .input("userId", sql.UniqueIdentifier, principal.id)
    .input("email", sql.NVarChar(320), principal.email.toLowerCase())
    .input("currentDate", sql.Date, currentDate)
    .query(`
      SELECT project.codigo_publico AS projectCode, project.nombre AS projectName,
        CONVERT(varchar(36), section.seccion_id) AS sectionId, section.codigo AS sectionCode,
        campus.nombre AS campusName, milestoneOne.estado AS hito1Status,
        milestoneTwoSection.estado AS hito2Status, milestoneThree.estado AS hito3Status,
        CONVERT(char(10), milestoneTwo.disponible_desde, 23) AS availableFrom,
        CASE WHEN milestoneTwo.disponible_desde IS NOT NULL AND milestoneTwo.disponible_desde <= @currentDate THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS hito2Available
      FROM vcm.Docente teacher
      INNER JOIN vcm.DocenteSeccion assignment ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
      INNER JOIN vcm.Seccion section ON section.seccion_id = assignment.seccion_id AND section.activa = 1
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.ProyectoSeccion projectSection ON projectSection.seccion_id = section.seccion_id
      INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id AND project.estado <> 'CANCELADO'
      LEFT JOIN vcm.HitoProyecto milestoneTwo ON milestoneTwo.proyecto_id = project.proyecto_id AND milestoneTwo.numero = 2
      LEFT JOIN vcm.HitoProyectoSeccion milestoneOne ON milestoneOne.proyecto_id = project.proyecto_id AND milestoneOne.seccion_id = section.seccion_id AND milestoneOne.numero = 1
      LEFT JOIN vcm.HitoProyectoSeccion milestoneTwoSection ON milestoneTwoSection.proyecto_id = project.proyecto_id AND milestoneTwoSection.seccion_id = section.seccion_id AND milestoneTwoSection.numero = 2
      LEFT JOIN vcm.HitoProyectoSeccion milestoneThree ON milestoneThree.proyecto_id = project.proyecto_id AND milestoneThree.seccion_id = section.seccion_id AND milestoneThree.numero = 3
      WHERE teacher.activo = 1 AND (teacher.usuario_id = @userId OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = @email))
      ORDER BY project.codigo_publico, campus.nombre, section.codigo;
    `);
  return result.recordset;
}

async function notificationReadKeys(pool, userId) {
  const availability = await pool.request().query("SELECT CASE WHEN OBJECT_ID('vcm.NotificacionVista', 'U') IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS enabled;");
  if (!availability.recordset[0].enabled) return { enabled: false, keys: [] };
  const result = await pool.request().input("userId", sql.UniqueIdentifier, userId)
    .query("SELECT clave AS [key] FROM vcm.NotificacionVista WHERE usuario_id = @userId;");
  return { enabled: true, keys: result.recordset.map((row) => row.key) };
}

async function listNotifications(principal) {
  const pool = await getPool();
  const [teachingRows, readState] = await Promise.all([
    listTeachingNotificationRows(pool, principal),
    notificationReadKeys(pool, principal.id),
  ]);
  let coordinationAlerts = [];
  let qualityReport = null;
  if (["admin", "coordinator"].includes(principal.role)) {
    const [monitoring, quality] = await Promise.all([
      listCoordinationMonitoring(),
      queryDataQualityRows(pool).then(buildDataQualityReport),
    ]);
    coordinationAlerts = monitoring.alerts;
    qualityReport = quality;
  }
  return { ...buildNotifications({ coordinationAlerts, qualityReport, teachingRows, readKeys: readState.keys }), readStateEnabled: readState.enabled };
}

function validateNotificationKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 200) throw new AppError(400, "INVALID_NOTIFICATION_KEY", "La notificación no es válida.");
  return key;
}

async function markNotificationRead(principal, keyValue) {
  const key = validateNotificationKey(keyValue);
  const pool = await getPool();
  const availability = await notificationReadKeys(pool, principal.id);
  if (!availability.enabled) throw new AppError(503, "NOTIFICATION_STATE_UNAVAILABLE", "Ejecuta la migración 008 para guardar el estado de las notificaciones.");
  await pool.request().input("userId", sql.UniqueIdentifier, principal.id).input("key", sql.NVarChar(200), key).query(`
    MERGE vcm.NotificacionVista WITH (HOLDLOCK) AS target
    USING (SELECT @userId AS usuario_id, @key AS clave) AS source
      ON target.usuario_id = source.usuario_id AND target.clave = source.clave
    WHEN MATCHED THEN UPDATE SET leida_en = SYSUTCDATETIME(), actualizada_en = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (usuario_id, clave) VALUES (source.usuario_id, source.clave);
  `);
  return { key, read: true };
}

async function markAllNotificationsRead(principal) {
  const current = await listNotifications(principal);
  if (!current.readStateEnabled) throw new AppError(503, "NOTIFICATION_STATE_UNAVAILABLE", "Ejecuta la migración 008 para guardar el estado de las notificaciones.");
  const keys = current.records.map((record) => record.key);
  if (!keys.length) return { updated: 0 };
  const pool = await getPool();
  await pool.request().input("userId", sql.UniqueIdentifier, principal.id).input("keys", sql.NVarChar(sql.MAX), JSON.stringify(keys)).query(`
    MERGE vcm.NotificacionVista WITH (HOLDLOCK) AS target
    USING (SELECT @userId AS usuario_id, [value] AS clave FROM OPENJSON(@keys)) AS source
      ON target.usuario_id = source.usuario_id AND target.clave = source.clave
    WHEN MATCHED THEN UPDATE SET leida_en = SYSUTCDATETIME(), actualizada_en = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (usuario_id, clave) VALUES (source.usuario_id, source.clave);
  `);
  return { updated: keys.length };
}

module.exports = { getDataQuality, listControlAudit, listNotifications, markAllNotificationsRead, markNotificationRead, queryDataQualityRows };
