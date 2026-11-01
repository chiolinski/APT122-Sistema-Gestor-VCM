const { sql } = require("../src/lib/db");
const { getConfig } = require("../src/lib/config");
const { assertSqlTarget, LOCAL_DATABASE } = require("../src/lib/localSafety");
const { BlobServiceClient } = require("@azure/storage-blob");
async function main() {
  const config = getConfig();
  const parsed = new sql.ConnectionPool(config.sqlConnectionString).config;
  assertSqlTarget(parsed);
  const masterConfig = { ...parsed, database: "master" };
  assertSqlTarget(masterConfig, { allowMaster: true });
  let pool;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = new sql.ConnectionPool(masterConfig);
    try { pool = await candidate.connect(); break; }
    catch {
      await candidate.close().catch(() => {});
      if (attempt === 29) throw new Error("SQL local no respondió. Inicia Docker Desktop y ejecuta npm run local:infra; revisa docker compose logs sql.");
      console.log("Esperando SQL Server local...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  try {
    await pool.request().query(`IF DB_ID('${LOCAL_DATABASE}') IS NULL CREATE DATABASE [${LOCAL_DATABASE}];`);
  } finally { await pool.close(); }
  const service = BlobServiceClient.fromConnectionString(config.blobConnectionString);
  for (const name of [config.blobContainerName, config.videoContainerName]) {
    await service.getContainerClient(name).createIfNotExists();
  }
  await service.setProperties({ cors: [{ allowedOrigins: "http://127.0.0.1:5176,http://127.0.0.1:4176",
    allowedMethods: "GET,HEAD,PUT,OPTIONS", allowedHeaders: "*", exposedHeaders: "ETag,x-ms-request-id", maxAgeInSeconds: 300 }] });
  console.log("Base local y contenedores privados preparados.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
