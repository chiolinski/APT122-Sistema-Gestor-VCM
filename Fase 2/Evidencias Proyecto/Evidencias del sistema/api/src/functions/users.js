const { app } = require("@azure/functions");
const { requireAdmin } = require("../lib/auth");
const { AppError, created, handleError, ok, readJson } = require("../lib/http");
const { createUser, listUsers, resetPassword, setUserActive } = require("../repositories/userRepository");

app.http("listUsers", {
  methods: ["GET"], authLevel: "anonymous", route: "users",
  handler: async (request, context) => {
    try {
      await requireAdmin(request);
      return ok(await listUsers());
    } catch (error) { return handleError(error, context); }
  },
});

app.http("createUser", {
  methods: ["POST"], authLevel: "anonymous", route: "users",
  handler: async (request, context) => {
    try {
      const actor = await requireAdmin(request);
      return created(await createUser(await readJson(request), actor));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("setUserStatus", {
  methods: ["PATCH"], authLevel: "anonymous", route: "users/{id}",
  handler: async (request, context) => {
    try {
      const actor = await requireAdmin(request);
      const body = await readJson(request);
      if (typeof body.active !== "boolean") {
        throw new AppError(400, "INVALID_STATUS", "El estado de la cuenta no es válido.");
      }
      return ok(await setUserActive(request.params.id, body.active === true, actor));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("resetUserPassword", {
  methods: ["POST"], authLevel: "anonymous", route: "users/{id}/password",
  handler: async (request, context) => {
    try {
      const actor = await requireAdmin(request);
      const body = await readJson(request);
      return ok(await resetPassword(request.params.id, body.password, actor, true));
    } catch (error) { return handleError(error, context); }
  },
});
