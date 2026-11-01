const sql = require("mssql");
const { getConfig } = require("./config");

const { LOCAL_DATABASE, assertSqlTarget } = require("./localSafety");

let poolPromise;

function getPool() {
  const { sqlConnectionString } = getConfig();
  if (!sqlConnectionString) throw new Error("Falta la variable AZURE_SQL_CONNECTION_STRING.");
  const candidate = new sql.ConnectionPool(sqlConnectionString);
  assertSqlTarget(candidate.config);
  if (!poolPromise) {
    poolPromise = candidate.connect().then(async (pool) => {
      const check = await pool.request().query("SELECT DB_NAME() AS name;");
      if (check.recordset[0]?.name !== LOCAL_DATABASE) {
        await pool.close();
        throw new Error("Aislamiento local: la base conectada no es la base de pruebas.");
      }
      return pool;
    }).catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

async function withTransaction(operation) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = { sql, getPool, withTransaction };
