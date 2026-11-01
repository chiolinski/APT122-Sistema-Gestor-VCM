const { app } = require("@azure/functions");
const { getPool } = require("../lib/db");
const { response } = require("../lib/http");

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: async (_request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT DB_NAME() AS databaseName,
          (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'vcm') AS tableCount,
          CASE WHEN OBJECT_ID('vcm.Migracion', 'U') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM vcm.Migracion) END AS migrationCount;
      `);
      return response(200, { status: "ok", service: "vcm-piloto-2026-api", database: result.recordset[0], timestamp: new Date().toISOString() });
    } catch (error) {
      context.error("Health check sin conexión a Azure SQL", error);
      return response(503, { status: "degraded", service: "vcm-piloto-2026-api", database: "unavailable", timestamp: new Date().toISOString() });
    }
  },
});
