const { AppError } = require("../lib/http");
const { hashPassword } = require("../lib/password");
const { sql, getPool, withTransaction } = require("../lib/db");
const { writeAudit } = require("../lib/audit");

const ROLE_TITLES = {
  ADMIN: ["Administrador"],
  COORDINATOR: ["Coordinador CITT", "Director de Carrera"],
  TEACHER: ["Docente"],
};

function normalizeAcademicIdentifier(value) {
  return String(value || "").trim().toUpperCase().replace(/[.\-\s]/g, "");
}

function validateAccount(input) {
  const email = String(input.email || "").trim().toLowerCase();
  const name = String(input.name || "").trim();
  const role = String(input.role || "").trim().toUpperCase();
  const title = String(input.title || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
    throw new AppError(400, "INVALID_EMAIL", "Ingresa un correo electrónico válido.");
  }
  if (name.length < 3 || name.length > 180) {
    throw new AppError(400, "INVALID_NAME", "El nombre debe tener entre 3 y 180 caracteres.");
  }
  if (!ROLE_TITLES[role] || !ROLE_TITLES[role].includes(title)) {
    throw new AppError(400, "INVALID_ROLE", "El rol o cargo seleccionado no es válido.");
  }
  const teacherSourceId = role === "TEACHER" ? normalizeAcademicIdentifier(input.teacherSourceId) : null;
  if (role === "TEACHER" && (teacherSourceId.length < 4 || teacherSourceId.length > 30)) {
    throw new AppError(400, "INVALID_TEACHER_ID", "Ingresa el RUT o código académico del docente cargado previamente.");
  }
  return { email, name, role, title, teacherSourceId };
}

function buildUsersWithCampuses(users = [], campusRows = []) {
  const campusesByUser = new Map();
  for (const row of campusRows) {
    if (!campusesByUser.has(row.userId)) campusesByUser.set(row.userId, new Map());
    campusesByUser.get(row.userId).set(row.campusId, {
      id: row.campusId, code: row.campusCode, name: row.campusName,
    });
  }
  return users.map((user) => ({
    ...user,
    campuses: [...(campusesByUser.get(user.id)?.values() || [])].sort((left, right) => (
      left.name.localeCompare(right.name, "es", { sensitivity: "base", numeric: true })
      || left.code.localeCompare(right.code, "es", { sensitivity: "base", numeric: true })
    )),
  }));
}

async function listUsers() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CONVERT(varchar(36), usr.usuario_id) AS id, usr.correo AS email, usr.nombre AS name,
      LOWER(usr.rol) AS role, usr.cargo_visual AS title, usr.activo AS active,
      CASE WHEN password_hash IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS hasPassword,
      usr.ultimo_acceso_en AS lastAccessAt, usr.creado_en AS createdAt,
      teacher.identificador_fuente AS teacherSourceId,
      CASE WHEN teacher.docente_id IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS academicLinked
    FROM vcm.Usuario usr
    LEFT JOIN vcm.Docente teacher ON teacher.usuario_id = usr.usuario_id
    ORDER BY usr.activo DESC, usr.nombre;

    SELECT DISTINCT CONVERT(varchar(36), usr.usuario_id) AS userId,
      CONVERT(varchar(36), campus.sede_id) AS campusId,
      campus.codigo AS campusCode, campus.nombre AS campusName
    FROM vcm.Usuario usr
    INNER JOIN vcm.Docente teacher ON teacher.activo = 1
      AND (
        teacher.usuario_id = usr.usuario_id
        OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = LOWER(usr.correo))
      )
    INNER JOIN vcm.DocenteSeccion assignment
      ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
    INNER JOIN vcm.Seccion section
      ON section.seccion_id = assignment.seccion_id AND section.activa = 1
    INNER JOIN vcm.Asignatura subject
      ON subject.asignatura_id = section.asignatura_id AND subject.activa = 1
    INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id AND campus.activa = 1;
  `);
  return buildUsersWithCampuses(result.recordsets[0], result.recordsets[1]);
}

async function createUser(input, principal) {
  const account = validateAccount(input);
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (transaction) => {
      let teacherId = null;
      if (account.role === "TEACHER") {
        const teacher = await new sql.Request(transaction)
          .input("teacherSourceId", sql.NVarChar(30), account.teacherSourceId)
          .query(`
            SELECT TOP (1) CONVERT(varchar(36), docente_id) AS id, usuario_id AS userId
            FROM vcm.Docente WITH (UPDLOCK, HOLDLOCK)
            WHERE activo = 1
              AND UPPER(REPLACE(REPLACE(REPLACE(identificador_fuente, '.', ''), '-', ''), ' ', '')) = @teacherSourceId;
          `);
        if (!teacher.recordset[0]) {
          throw new AppError(400, "TEACHER_NOT_FOUND", "No se encontró ese RUT o código en la carga académica aplicada.");
        }
        if (teacher.recordset[0].userId) {
          throw new AppError(409, "TEACHER_ALREADY_LINKED", "Ese docente ya tiene una cuenta de acceso vinculada.");
        }
        teacherId = teacher.recordset[0].id;
      }

      const result = await new sql.Request(transaction)
        .input("email", sql.NVarChar(320), account.email)
        .input("name", sql.NVarChar(180), account.name)
        .input("role", sql.VarChar(20), account.role)
        .input("title", sql.NVarChar(100), account.title)
        .input("passwordHash", sql.NVarChar(255), passwordHash)
        .query(`
          INSERT INTO vcm.Usuario (correo, nombre, rol, cargo_visual, password_hash, password_actualizado_en)
          OUTPUT CONVERT(varchar(36), inserted.usuario_id) AS id, inserted.correo AS email,
            inserted.nombre AS name, LOWER(inserted.rol) AS role, inserted.cargo_visual AS title,
            inserted.activo AS active, CAST(1 AS bit) AS hasPassword
          VALUES (@email, @name, @role, @title, @passwordHash, SYSUTCDATETIME());
        `);
      const user = result.recordset[0];
      let linkedTeacherSourceId = account.teacherSourceId;

      if (teacherId) {
        await new sql.Request(transaction)
          .input("teacherId", sql.UniqueIdentifier, teacherId)
          .input("userId", sql.UniqueIdentifier, user.id)
          .input("email", sql.NVarChar(320), account.email)
          .query(`
            UPDATE vcm.Docente SET usuario_id = @userId, correo = @email,
              actualizado_en = SYSUTCDATETIME()
            WHERE docente_id = @teacherId;
          `);
      } else if (account.role === "COORDINATOR") {
        const linkedTeacher = await new sql.Request(transaction)
          .input("userId", sql.UniqueIdentifier, user.id)
          .input("email", sql.NVarChar(320), account.email)
          .query(`
            UPDATE teacher
            SET usuario_id = @userId, actualizado_en = SYSUTCDATETIME()
            OUTPUT inserted.identificador_fuente AS teacherSourceId
            FROM vcm.Docente teacher
            WHERE teacher.usuario_id IS NULL
              AND LOWER(teacher.correo) = @email
              AND 1 = (
                SELECT COUNT(*) FROM vcm.Docente matchingTeacher
                WHERE matchingTeacher.usuario_id IS NULL AND LOWER(matchingTeacher.correo) = @email
              );
          `);
        linkedTeacherSourceId = linkedTeacher.recordset[0]?.teacherSourceId || null;
      }

      const academicLinked = Boolean(teacherId || linkedTeacherSourceId);
      await writeAudit(transaction, principal, {
        action: "USER_CREATED", entity: "Usuario", entityId: user.id,
        description: `Cuenta creada para ${account.email}.`,
        data: { role: account.role, title: account.title, academicLinked },
      });
      return { ...user, teacherSourceId: linkedTeacherSourceId, academicLinked };
    });
  } catch (error) {
    if ([2601, 2627].includes(error.number)) {
      throw new AppError(409, "EMAIL_IN_USE", "Ya existe una cuenta con ese correo electrónico.");
    }
    throw error;
  }
}

async function setUserActive(userId, active, principal) {
  if (userId === principal?.id && !active) {
    throw new AppError(400, "CANNOT_DISABLE_SELF", "No puedes desactivar tu propia cuenta.");
  }
  return withTransaction(async (transaction) => {
    const result = await new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, userId)
      .input("active", sql.Bit, active)
      .query(`
        UPDATE vcm.Usuario SET activo = @active, actualizado_en = SYSUTCDATETIME()
        OUTPUT CONVERT(varchar(36), inserted.usuario_id) AS id, inserted.activo AS active
        WHERE usuario_id = @id;
      `);
    if (!result.recordset[0]) throw new AppError(404, "USER_NOT_FOUND", "No se encontró el usuario.");
    if (!active) {
      await new sql.Request(transaction).input("id", sql.UniqueIdentifier, userId)
        .query("DELETE FROM vcm.SesionUsuario WHERE usuario_id = @id;");
    }
    await writeAudit(transaction, principal, {
      action: active ? "USER_ENABLED" : "USER_DISABLED", entity: "Usuario", entityId: userId,
      description: `Cuenta ${active ? "activada" : "desactivada"} por administración.`,
    });
    return result.recordset[0];
  });
}

async function resetPassword(userId, password, principal = null, denyOwnAccount = false) {
  if (denyOwnAccount && userId === principal?.id) {
    throw new AppError(400, "USE_OWN_PASSWORD_FLOW", "Cambia tu propia contraseña desde Mi cuenta.");
  }
  const passwordHash = await hashPassword(password);
  return withTransaction(async (transaction) => {
    const result = await new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, userId)
      .input("passwordHash", sql.NVarChar(255), passwordHash)
      .query(`
        UPDATE vcm.Usuario SET password_hash = @passwordHash, password_actualizado_en = SYSUTCDATETIME(),
          intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = SYSUTCDATETIME()
        OUTPUT CONVERT(varchar(36), inserted.usuario_id) AS id
        WHERE usuario_id = @id;
      `);
    if (!result.recordset[0]) throw new AppError(404, "USER_NOT_FOUND", "No se encontró el usuario.");
    await new sql.Request(transaction).input("id", sql.UniqueIdentifier, userId)
      .query("DELETE FROM vcm.SesionUsuario WHERE usuario_id = @id;");
    await writeAudit(transaction, principal, {
      action: "PASSWORD_CHANGED", entity: "Usuario", entityId: userId,
      description: denyOwnAccount ? "Contraseña restablecida por administración." : "Contraseña actualizada por el usuario.",
    });
    return result.recordset[0];
  });
}

module.exports = { buildUsersWithCampuses, createUser, listUsers, normalizeAcademicIdentifier, resetPassword, setUserActive, validateAccount };
