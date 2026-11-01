const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sql, getPool } = require("../src/lib/db");

const EXPECTED_DATABASE = "vcm_piloto_2026_local";
const migrationsDirectory = path.resolve(__dirname, "../../database/migrations");

function splitBatches(content) {
  return content.split(/^\s*GO\s*;?\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
}

async function migrationExists(transaction, filename) {
  const table = await new sql.Request(transaction).query("SELECT OBJECT_ID('vcm.Migracion', 'U') AS id;");
  if (!table.recordset[0]?.id) return false;
  const result = await new sql.Request(transaction)
    .input("filename", sql.NVarChar(260), filename)
    .query("SELECT COUNT(*) AS total FROM vcm.Migracion WHERE archivo = @filename;");
  return result.recordset[0].total > 0;
}

async function main() {
  const pool = await getPool();
  const database = await pool.request().query("SELECT DB_NAME() AS name;");
  const databaseName = String(database.recordset[0]?.name || "");
  if (databaseName.toLowerCase() !== EXPECTED_DATABASE) {
    throw new Error(`Migración detenida: la conexión apunta a '${databaseName}' y debe apuntar a '${EXPECTED_DATABASE}'.`);
  }

  const files = fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
  for (const filename of files) {
    const content = fs.readFileSync(path.join(migrationsDirectory, filename), "utf8");
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      if (await migrationExists(transaction, filename)) {
        await transaction.rollback();
        console.log(`Omitida ${filename}: ya aplicada.`);
        continue;
      }
      for (const batch of splitBatches(content)) await new sql.Request(transaction).batch(batch);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      await new sql.Request(transaction)
        .input("filename", sql.NVarChar(260), filename)
        .input("hash", sql.Char(64), hash)
        .query("INSERT INTO vcm.Migracion (archivo, hash_sha256) VALUES (@filename, @hash);");
      await transaction.commit();
      console.log(`Aplicada ${filename}.`);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  await pool.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
