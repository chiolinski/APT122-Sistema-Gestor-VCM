const { app } = require("@azure/functions");
const { getConfig } = require("../lib/config");
const { SESSION_COOKIE, getPrincipal, readCookie, requireUser } = require("../lib/auth");
const { AppError, handleError, ok, readJson, response } = require("../lib/http");
const { authenticate, createSession, revokeSession } = require("../repositories/authRepository");
const { getAccountProfile } = require("../repositories/accountProfileRepository");
const { resetPassword } = require("../repositories/userRepository");

function sessionCookie(token, expires = false) {
  const { secureCookies, sessionHours } = getConfig();
  const attributes = [
    `${SESSION_COOKIE}=${expires ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    expires ? "Max-Age=0" : `Max-Age=${sessionHours * 60 * 60}`,
  ];
  if (secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

app.http("login", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/login",
  handler: async (request, context) => {
    try {
      const body = await readJson(request);
      if (typeof body.email !== "string" || typeof body.password !== "string") {
        throw new AppError(400, "CREDENTIALS_REQUIRED", "Ingresa tu correo y contraseña.");
      }
      const user = await authenticate(body.email, body.password);
      if (!user) throw new AppError(401, "INVALID_CREDENTIALS", "El correo o la contraseña no son correctos.");
      const token = await createSession(user, request);
      return response(200, { data: user }, { "Set-Cookie": sessionCookie(token) });
    } catch (error) { return handleError(error, context); }
  },
});

app.http("currentSession", {
  methods: ["GET"], authLevel: "anonymous", route: "auth/session",
  handler: async (request, context) => {
    try {
      const user = await getPrincipal(request);
      if (!user) throw new AppError(401, "AUTH_REQUIRED", "No existe una sesión activa.");
      return ok(user);
    } catch (error) { return handleError(error, context); }
  },
});

app.http("accountProfile", {
  methods: ["GET"], authLevel: "anonymous", route: "account/profile",
  handler: async (request, context) => {
    try {
      const principal = await requireUser(request);
      return ok(await getAccountProfile(principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("logout", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/logout",
  handler: async (request, context) => {
    try {
      await revokeSession(readCookie(request, SESSION_COOKIE));
      return response(200, { data: { loggedOut: true } }, { "Set-Cookie": sessionCookie("", true) });
    } catch (error) { return handleError(error, context); }
  },
});

app.http("changeOwnPassword", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/password",
  handler: async (request, context) => {
    try {
      const principal = await requireUser(request);
      const body = await readJson(request);
      if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
        throw new AppError(400, "PASSWORDS_REQUIRED", "Completa la contraseña actual y la nueva.");
      }
      const verified = await authenticate(principal.email, body.currentPassword);
      if (!verified || verified.id !== principal.id) {
        throw new AppError(401, "INVALID_CURRENT_PASSWORD", "La contraseña actual no es correcta.");
      }
      await resetPassword(principal.id, body.newPassword, principal);
      const token = await createSession(principal, request);
      return response(200, { data: { changed: true } }, { "Set-Cookie": sessionCookie(token) });
    } catch (error) { return handleError(error, context); }
  },
});

module.exports = { sessionCookie };
