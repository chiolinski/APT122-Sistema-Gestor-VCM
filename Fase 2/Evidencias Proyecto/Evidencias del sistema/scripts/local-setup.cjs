const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
for (const script of ["scripts/local-config.cjs", "api/scripts/init-local.js", "api/scripts/migrate.js", "api/scripts/seed-local.js"]) {
  const result = spawnSync(process.execPath, [path.join(root, script)], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("Base y almacenamiento locales preparados. Inicia npm run local:api y npm run dev en terminales separadas.");
