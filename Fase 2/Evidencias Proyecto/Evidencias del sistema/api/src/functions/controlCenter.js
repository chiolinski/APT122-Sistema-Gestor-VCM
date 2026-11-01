const { app } = require("@azure/functions");
const { requireUser } = require("../lib/auth");
const { assertControlAccess } = require("../lib/controlCenter");
const { handleError, ok } = require("../lib/http");
const {
  getDataQuality,
  listControlAudit,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = require("../repositories/controlCenterRepository");

app.http("controlAudit", {
  methods: ["GET"], authLevel: "anonymous", route: "control/audit",
  handler: async (request, context) => {
    try {
      const principal = assertControlAccess(await requireUser(request));
      const url = new URL(request.url);
      return ok(await listControlAudit({
        query: url.searchParams.get("query"),
        action: url.searchParams.get("action"),
        entity: url.searchParams.get("entity"),
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize"),
      }, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("controlDataQuality", {
  methods: ["GET"], authLevel: "anonymous", route: "control/data-quality",
  handler: async (request, context) => {
    try {
      const principal = assertControlAccess(await requireUser(request));
      return ok(await getDataQuality(principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("notifications", {
  methods: ["GET"], authLevel: "anonymous", route: "notifications",
  handler: async (request, context) => {
    try { return ok(await listNotifications(await requireUser(request))); }
    catch (error) { return handleError(error, context); }
  },
});

app.http("readNotification", {
  methods: ["POST"], authLevel: "anonymous", route: "notifications/{key}/read",
  handler: async (request, context) => {
    try { return ok(await markNotificationRead(await requireUser(request), decodeURIComponent(request.params.key))); }
    catch (error) { return handleError(error, context); }
  },
});

app.http("readAllNotifications", {
  methods: ["POST"], authLevel: "anonymous", route: "notifications/read-all",
  handler: async (request, context) => {
    try { return ok(await markAllNotificationsRead(await requireUser(request))); }
    catch (error) { return handleError(error, context); }
  },
});
