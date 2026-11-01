const crypto = require("node:crypto");
const { getConfig } = require("../lib/config");
const { sql, getPool, withTransaction } = require("../lib/db");
const { DUMMY_HASH, verifyPassword } = require("../lib/password");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toProfile(row) {
  const initials = row.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const role = row.role.toLowerCase();
  const canTeach = ["teacher", "coordinator"].includes(role) && Boolean(row.canTeach);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role,
    title: row.title,
    initials,
    canTeach,
  };
}

async function authenticate(email, password) {
  const pool = await getPool();
  const result = await pool.request()
    .input("email", sql.NVarChar(320), email.trim().toLowerCase())
    .query(`
      SELECT CONVERT(varchar(36), usr.usuario_id) AS id, usr.correo AS email, usr.nombre AS name,
        usr.rol AS role, usr.cargo_visual AS title, usr.password_hash AS passwordHash, usr.activo AS active,
        usr.bloqueado_hasta AS lockedUntil,
        CASE WHEN EXISTS (
          SELECT 1
          FROM vcm.Docente teacher
          INNER JOIN vcm.DocenteSeccion assignment
            ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
          INNER JOIN vcm.Seccion section
            ON section.seccion_id = assignment.seccion_id AND section.activa = 1
          INNER JOIN vcm.Asignatura subject
            ON subject.asignatura_id = section.asignatura_id AND subject.activa = 1
          WHERE teacher.activo = 1
            AND (
              teacher.usuario_id = usr.usuario_id
              OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = LOWER(usr.correo))
            )
        ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS canTeach
      FROM vcm.Usuario usr WHERE LOWER(usr.correo) = @email;
    `);
  const user = result.recordset[0];
  const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
  const locked = user?.lockedUntil && new Date(user.lockedUntil) > new Date();

  if (!user || !valid || !user.active || locked) {
    if (user && !valid && user.active && !locked) {
      await pool.request().input("id", sql.UniqueIdentifier, user.id).query(`
        UPDATE vcm.Usuario SET
          intentos_fallidos = intentos_fallidos + 1,
          bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= 5 THEN DATEADD(minute, 15, SYSUTCDATETIME()) ELSE bloqueado_hasta END,
          actualizado_en = SYSUTCDATETIME()
        WHERE usuario_id = @id;
      `);
    }
    return null;
  }

  await pool.request().input("id", sql.UniqueIdentifier, user.id).query(`
    UPDATE vcm.Usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL,
      ultimo_acceso_en = SYSUTCDATETIME(), actualizado_en = SYSUTCDATETIME()
    WHERE usuario_id = @id;
  `);
  return toProfile(user);
}

async function createSession(user, request) {
  const { sessionHours } = getConfig();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 300);
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0].trim().slice(0, 64);

  await withTransaction(async (transaction) => {
    await new sql.Request(transaction).query("DELETE FROM vcm.SesionUsuario WHERE expira_en <= SYSUTCDATETIME();");
    await new sql.Request(transaction)
      .input("userId", sql.UniqueIdentifier, user.id)
      .input("tokenHash", sql.Char(64), tokenHash)
      .input("hours", sql.Int, sessionHours)
      .input("userAgent", sql.NVarChar(300), userAgent || null)
      .input("ip", sql.VarChar(64), ip || null)
      .query(`
        INSERT INTO vcm.SesionUsuario (usuario_id, token_hash, expira_en, user_agent, direccion_ip)
        VALUES (@userId, @tokenHash, DATEADD(hour, @hours, SYSUTCDATETIME()), @userAgent, @ip);
      `);
  });
  return token;
}

async function findSession(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 100) return null;
  const pool = await getPool();
  const result = await pool.request().input("tokenHash", sql.Char(64), hashToken(token)).query(`
    SELECT CONVERT(varchar(36), usr.usuario_id) AS id, usr.correo AS email, usr.nombre AS name,
      usr.rol AS role, usr.cargo_visual AS title,
      CASE WHEN EXISTS (
        SELECT 1
        FROM vcm.Docente teacher
        INNER JOIN vcm.DocenteSeccion assignment
          ON assignment.docente_id = teacher.docente_id AND assignment.vigente = 1
        INNER JOIN vcm.Seccion section
          ON section.seccion_id = assignment.seccion_id AND section.activa = 1
        INNER JOIN vcm.Asignatura subject
          ON subject.asignatura_id = section.asignatura_id AND subject.activa = 1
        WHERE teacher.activo = 1
          AND (
            teacher.usuario_id = usr.usuario_id
            OR (teacher.usuario_id IS NULL AND LOWER(teacher.correo) = LOWER(usr.correo))
          )
      ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS canTeach
    FROM vcm.SesionUsuario sess
    INNER JOIN vcm.Usuario usr ON usr.usuario_id = sess.usuario_id
    WHERE sess.token_hash = @tokenHash AND sess.expira_en > SYSUTCDATETIME() AND usr.activo = 1;

    UPDATE vcm.SesionUsuario SET ultimo_uso_en = SYSUTCDATETIME()
    WHERE token_hash = @tokenHash AND expira_en > SYSUTCDATETIME();
  `);
  return result.recordset[0] ? toProfile(result.recordset[0]) : null;
}

async function revokeSession(token) {
  if (!token) return;
  const pool = await getPool();
  await pool.request().input("tokenHash", sql.Char(64), hashToken(token))
    .query("DELETE FROM vcm.SesionUsuario WHERE token_hash = @tokenHash;");
}

module.exports = { authenticate, createSession, findSession, hashToken, revokeSession, toProfile };
