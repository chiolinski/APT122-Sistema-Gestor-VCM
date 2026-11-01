const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
let password;
if (fs.existsSync(envPath)) {
  password = fs.readFileSync(envPath, "utf8").match(/^VCM_LOCAL_SQL_PASSWORD=([A-Za-z0-9!]+)$/m)?.[1];
  if (!password) throw new Error("El .env local no contiene una contraseña válida; no se sobrescribe.");
} else {
  password = `LocalVCM9!${crypto.randomBytes(18).toString("hex")}`;
  fs.writeFileSync(envPath, `VCM_LOCAL_SQL_PASSWORD=${password}\n`, { flag: "wx" });
}
const file = path.join(root, "api/local.settings.json");
if (!fs.existsSync(file)) {
  const settings = JSON.parse(fs.readFileSync(path.join(root, "api/local.settings.example.json"), "utf8"));
  settings.Values.AZURE_SQL_CONNECTION_STRING = `Server=127.0.0.1,14333;Database=vcm_piloto_2026_local;User Id=sa;Password=${password};Encrypt=false;TrustServerCertificate=true;Connection Timeout=5;`;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", { flag: "wx" });
}
console.log("Configuración local lista. Los archivos existentes y sus datos se conservan.");
