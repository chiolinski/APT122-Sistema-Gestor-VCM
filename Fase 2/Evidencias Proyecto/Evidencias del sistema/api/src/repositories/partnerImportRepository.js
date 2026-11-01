const crypto = require("node:crypto");
const { AppError } = require("../lib/http");
const { sql, getPool, withTransaction } = require("../lib/db");
const { writeAudit } = require("../lib/audit");

function jsonRequest(connection, payload) {
  return new sql.Request(connection).input("payload", sql.NVarChar(sql.MAX), JSON.stringify(payload));
}

async function existingPartnerRuts(connection, partners) {
  if (!partners.length) return new Set();
  const result = await jsonRequest(connection, partners).query(`
    SELECT source.taxId
    FROM OPENJSON(@payload) WITH (taxId varchar(20) '$.taxId') source
    INNER JOIN vcm.SocioFormador partner
      ON UPPER(REPLACE(REPLACE(REPLACE(partner.rut, '.', ''), ' ', ''), '-', ''))
        = REPLACE(source.taxId, '-', '');
  `);
  return new Set(result.recordset.map((row) => row.taxId));
}

async function previewPartnerImport(parsed) {
  if (!parsed.canApply) return parsed;
  const pool = await getPool();
  const existing = await existingPartnerRuts(pool, parsed.data);
  return {
    ...parsed,
    summary: {
      ...parsed.summary,
      creates: parsed.data.filter((partner) => !existing.has(partner.taxId)).length,
      updates: parsed.data.filter((partner) => existing.has(partner.taxId)).length,
    },
  };
}

async function applyPartnerImport(parsed, filename, principal) {
  if (!parsed.canApply) {
    throw new AppError(422, "PARTNER_IMPORT_HAS_ERRORS", "Corrige los errores antes de confirmar la carga.", parsed.issues);
  }
  const hash = crypto.createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");

  return withTransaction(async (transaction) => {
    const duplicate = await new sql.Request(transaction)
      .input("hash", sql.Char(64), hash)
      .query(`
        SELECT TOP (1) CONVERT(varchar(36), carga_socio_formador_id) AS id,
          nombre_archivo AS filename, estado AS status, total_filas AS rows,
          total_socios AS partners, total_creados AS created, total_actualizados AS updated,
          total_duplicados AS duplicates, aplicado_en AS appliedAt
        FROM vcm.CargaSocioFormador WHERE hash_sha256 = @hash;
      `);
    if (duplicate.recordset[0]) return { ...duplicate.recordset[0], duplicate: true };

    const existing = await existingPartnerRuts(transaction, parsed.data);
    const created = parsed.data.filter((partner) => !existing.has(partner.taxId)).length;
    const updated = parsed.data.length - created;
    const load = await new sql.Request(transaction)
      .input("filename", sql.NVarChar(260), String(filename || "socios-formadores.csv").slice(0, 260))
      .input("hash", sql.Char(64), hash)
      .input("rows", sql.Int, parsed.summary.rows)
      .input("partners", sql.Int, parsed.summary.partners)
      .input("created", sql.Int, created)
      .input("updated", sql.Int, updated)
      .input("duplicates", sql.Int, parsed.summary.duplicates)
      .input("warnings", sql.Int, parsed.summary.warnings)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .input("actorEmail", sql.NVarChar(320), principal.email)
      .query(`
        INSERT INTO vcm.CargaSocioFormador
          (nombre_archivo, hash_sha256, total_filas, total_socios, total_creados,
           total_actualizados, total_duplicados, total_advertencias,
           aplicado_por_usuario_id, aplicado_por, estado, aplicado_en)
        OUTPUT CONVERT(varchar(36), inserted.carga_socio_formador_id) AS id,
          inserted.nombre_archivo AS filename, inserted.estado AS status,
          inserted.aplicado_en AS appliedAt
        VALUES
          (@filename, @hash, @rows, @partners, @created, @updated, @duplicates,
           @warnings, @actorId, @actorEmail, 'APLICADA', SYSUTCDATETIME());
      `);

    await jsonRequest(transaction, parsed.data)
      .input("actorId", sql.UniqueIdentifier, principal.id)
      .query(`
        MERGE vcm.SocioFormador WITH (HOLDLOCK) AS target
        USING OPENJSON(@payload) WITH (
          taxId varchar(20) '$.taxId', businessName nvarchar(350) '$.businessName',
          industry nvarchar(150) '$.industry', contactName nvarchar(180) '$.contactName',
          contactEmail nvarchar(320) '$.contactEmail', phone nvarchar(40) '$.phone'
        ) AS source
        ON UPPER(REPLACE(REPLACE(REPLACE(target.rut, '.', ''), ' ', ''), '-', ''))
          = REPLACE(source.taxId, '-', '')
        WHEN MATCHED THEN UPDATE SET
          rut = source.taxId, razon_social = source.businessName, rubro = source.industry,
          contacto_nombre = source.contactName, contacto_correo = source.contactEmail,
          contacto_telefono = source.phone, activo = 1, actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (rut, razon_social, rubro, contacto_nombre, contacto_correo,
           contacto_telefono, creado_por_usuario_id)
          VALUES
          (source.taxId, source.businessName, source.industry, source.contactName,
           source.contactEmail, source.phone, @actorId);
      `);

    const result = {
      ...load.recordset[0], duplicate: false,
      rows: parsed.summary.rows, partners: parsed.summary.partners,
      created, updated, duplicates: parsed.summary.duplicates,
      warnings: parsed.summary.warnings,
    };
    await writeAudit(transaction, principal, {
      action: "PARTNER_IMPORT_APPLIED", entity: "CargaSocioFormador", entityId: result.id,
      description: `Carga masiva de socios aplicada: ${created} creados y ${updated} actualizados.`,
      data: { filename: result.filename, created, updated, duplicates: result.duplicates },
    });
    return result;
  });
}

async function listPartnerImports() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (25) CONVERT(varchar(36), carga_socio_formador_id) AS id,
      nombre_archivo AS filename, estado AS status, total_filas AS rows,
      total_socios AS partners, total_creados AS created, total_actualizados AS updated,
      total_duplicados AS duplicates, total_advertencias AS warnings,
      aplicado_por AS appliedBy, aplicado_en AS appliedAt
    FROM vcm.CargaSocioFormador
    ORDER BY creado_en DESC;
  `);
  return result.recordset;
}

module.exports = { applyPartnerImport, listPartnerImports, previewPartnerImport };
