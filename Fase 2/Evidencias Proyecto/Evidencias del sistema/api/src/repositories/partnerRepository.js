const { sql, getPool, withTransaction } = require("../lib/db");
const { AppError } = require("../lib/http");
const { UUID_PATTERN } = require("../lib/projectFiles");
const { writeAudit } = require("../lib/audit");

function mapPartner(row) {
  return {
    id: row.id,
    businessName: row.businessName,
    taxId: row.taxId,
    industry: row.industry,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    phone: row.phone,
  };
}

async function listPartners() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CONVERT(varchar(36), socio_formador_id) AS id, razon_social AS businessName,
      rut AS taxId, rubro AS industry, contacto_nombre AS contactName,
      contacto_correo AS contactEmail, contacto_telefono AS phone
    FROM vcm.SocioFormador
    WHERE activo = 1
    ORDER BY razon_social;
  `);
  return result.recordset.map(mapPartner);
}

async function createPartner(input, principal) {
  return withTransaction(async (transaction) => {
    const actorId = principal.id;
    const result = await new sql.Request(transaction)
      .input("taxId", sql.VarChar(20), input.taxId)
      .input("businessName", sql.NVarChar(350), input.businessName)
      .input("industry", sql.NVarChar(150), input.industry)
      .input("contactName", sql.NVarChar(180), input.contactName)
      .input("contactEmail", sql.NVarChar(320), input.contactEmail)
      .input("phone", sql.NVarChar(40), input.phone)
      .input("actorId", sql.UniqueIdentifier, actorId)
      .query(`
        MERGE vcm.SocioFormador WITH (HOLDLOCK) AS target
        USING (SELECT @taxId AS taxId) AS source
          ON UPPER(REPLACE(REPLACE(REPLACE(target.rut, '.', ''), ' ', ''), '-', ''))
            = REPLACE(source.taxId, '-', '')
        WHEN MATCHED THEN UPDATE SET rut = @taxId, razon_social = @businessName, rubro = @industry,
          contacto_nombre = @contactName, contacto_correo = @contactEmail,
          contacto_telefono = @phone, activo = 1, actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (rut, razon_social, rubro, contacto_nombre, contacto_correo, contacto_telefono, creado_por_usuario_id)
          VALUES (@taxId, @businessName, @industry, @contactName, @contactEmail, @phone, @actorId)
        OUTPUT CONVERT(varchar(36), inserted.socio_formador_id) AS id,
          inserted.razon_social AS businessName, inserted.rut AS taxId, inserted.rubro AS industry,
          inserted.contacto_nombre AS contactName, inserted.contacto_correo AS contactEmail,
          inserted.contacto_telefono AS phone;
      `);
    const partner = mapPartner(result.recordset[0]);
    await writeAudit(transaction, principal, {
      action: "PARTNER_SAVED", entity: "SocioFormador", entityId: partner.id,
      description: `Socio formador ${partner.businessName} guardado.`, data: { taxId: partner.taxId },
    });
    return partner;
  });
}

async function updatePartner(id, input, principal) {
  if (!UUID_PATTERN.test(String(id || ""))) {
    throw new AppError(400, "INVALID_PARTNER_ID", "El identificador del socio formador no es válido.");
  }
  return withTransaction(async (transaction) => {
    const request = new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, id)
      .input("taxId", sql.VarChar(20), input.taxId)
      .input("businessName", sql.NVarChar(350), input.businessName)
      .input("industry", sql.NVarChar(150), input.industry)
      .input("contactName", sql.NVarChar(180), input.contactName)
      .input("contactEmail", sql.NVarChar(320), input.contactEmail)
      .input("phone", sql.NVarChar(40), input.phone);
    const duplicate = await request.query(`
      SELECT TOP (1) 1 AS found
      FROM vcm.SocioFormador WITH (UPDLOCK, HOLDLOCK)
      WHERE socio_formador_id <> @id
        AND UPPER(REPLACE(REPLACE(REPLACE(rut, '.', ''), ' ', ''), '-', '')) = REPLACE(@taxId, '-', '');
    `);
    if (duplicate.recordset.length) {
      throw new AppError(409, "PARTNER_RUT_EXISTS", "Ya existe otro socio formador con este RUT.");
    }
    const result = await new sql.Request(transaction)
      .input("id", sql.UniqueIdentifier, id)
      .input("taxId", sql.VarChar(20), input.taxId)
      .input("businessName", sql.NVarChar(350), input.businessName)
      .input("industry", sql.NVarChar(150), input.industry)
      .input("contactName", sql.NVarChar(180), input.contactName)
      .input("contactEmail", sql.NVarChar(320), input.contactEmail)
      .input("phone", sql.NVarChar(40), input.phone)
      .query(`
      UPDATE vcm.SocioFormador
      SET rut = @taxId, razon_social = @businessName, rubro = @industry,
        contacto_nombre = @contactName, contacto_correo = @contactEmail,
        contacto_telefono = @phone, actualizado_en = SYSUTCDATETIME()
      OUTPUT CONVERT(varchar(36), inserted.socio_formador_id) AS id,
        inserted.razon_social AS businessName, inserted.rut AS taxId, inserted.rubro AS industry,
        inserted.contacto_nombre AS contactName, inserted.contacto_correo AS contactEmail,
        inserted.contacto_telefono AS phone
      WHERE socio_formador_id = @id AND activo = 1;
    `);
    if (!result.recordset.length) {
      throw new AppError(404, "PARTNER_NOT_FOUND", "No se encontró el socio formador.");
    }
    const partner = mapPartner(result.recordset[0]);
    await writeAudit(transaction, principal, {
      action: "PARTNER_UPDATED", entity: "SocioFormador", entityId: partner.id,
      description: `Socio formador ${partner.businessName} actualizado por administración.`,
      data: { taxId: partner.taxId },
    });
    return partner;
  });
}

module.exports = { createPartner, listPartners, updatePartner };
