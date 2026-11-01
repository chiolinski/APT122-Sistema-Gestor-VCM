const { findSession } = require("../repositories/authRepository");
const { AppError } = require("./http");

const SESSION_COOKIE = "vcm_local_session";

function readCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) return valueParts.join("=");
  }
  return null;
}

async function getPrincipal(request) {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? findSession(token) : null;
}

async function requireUser(request) {
  const principal = await getPrincipal(request);
  if (!principal) throw new AppError(401, "AUTH_REQUIRED", "Debes iniciar sesión para realizar esta operación.");
  return principal;
}

async function requireRole(request, roles) {
  const principal = await requireUser(request);
  if (!roles.includes(principal.role)) {
    throw new AppError(403, "ROLE_REQUIRED", "No tienes permisos para realizar esta operación.");
  }
  return principal;
}

function requireAdmin(request) {
  return requireRole(request, ["admin"]);
}

async function requireTeachingCapability(request) {
  const principal = await requireUser(request);
  if (!["teacher", "coordinator"].includes(principal.role) || !principal.canTeach) {
    throw new AppError(403, "TEACHING_ASSIGNMENT_REQUIRED", "Necesitas una asignatura y sección vigentes para realizar esta operación.");
  }
  return principal;
}

module.exports = { SESSION_COOKIE, getPrincipal, readCookie, requireAdmin, requireRole, requireTeachingCapability, requireUser };
