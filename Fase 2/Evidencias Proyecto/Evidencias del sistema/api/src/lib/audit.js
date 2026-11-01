const { sql } = require("./db");

async function writeAudit(connection, principal, event, { required = false } = {}) {
  const actorId = principal?.id || null;
  const actorEmail = String(principal?.email || "sistema@example.test").trim().toLowerCase();
  const data = event.data == null ? null : JSON.stringify(event.data);
  try {
    await new sql.Request(connection)
      .input("actorId", sql.UniqueIdentifier, actorId)
      .input("actorEmail", sql.NVarChar(320), actorEmail)
      .input("action", sql.VarChar(60), event.action)
      .input("entity", sql.VarChar(60), event.entity)
      .input("entityId", sql.NVarChar(100), event.entityId == null ? null : String(event.entityId))
      .input("description", sql.NVarChar(500), event.description)
      .input("data", sql.NVarChar(sql.MAX), data)
      .query(`
        INSERT INTO vcm.Auditoria
          (usuario_id, usuario_correo, accion, entidad, entidad_id, descripcion, datos)
        VALUES
          (@actorId, @actorEmail, @action, @entity, @entityId, @description, @data);
      `);
  } catch (error) {
    // Mantiene los flujos existentes disponibles durante el breve intervalo entre despliegue y migración.
    if (error.number !== 208 || required) throw error;
  }
}

module.exports = { writeAudit };
