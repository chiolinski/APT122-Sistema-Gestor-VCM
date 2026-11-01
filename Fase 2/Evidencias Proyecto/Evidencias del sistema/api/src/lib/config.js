const fs = require("node:fs");
const path = require("node:path");
const { LOCAL_VIDEO_URL, assertLocalStorage, assertLocalVideo } = require("./localSafety");
const settingsPath = path.resolve(__dirname, "../../local.settings.json");
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  for (const [name, value] of Object.entries(settings.Values || {})) {
    if (process.env[name] === undefined) process.env[name] = String(value);
  }
}
function getConfig() {
  const config = {
    sqlConnectionString: process.env.AZURE_SQL_CONNECTION_STRING || "",
    blobConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || "UseDevelopmentStorage=true",
    blobContainerName: "vcm-local-project-files",
    videoAccountUrl: process.env.AZURE_STORAGE_VIDEO_ACCOUNT_URL || LOCAL_VIDEO_URL,
    videoContainerName: "vcm-local-videos",
    videoAccessMode: "private",
    videoConnectionString: process.env.AZURE_STORAGE_VIDEO_CONNECTION_STRING || "UseDevelopmentStorage=true",
    videoManagedIdentityClientId: process.env.AZURE_STORAGE_VIDEO_MANAGED_IDENTITY_CLIENT_ID || "",
    videoUploadEnabled: true,
    projectFileMaxBytes: 15 * 1024 * 1024,
    sessionHours: 12,
    secureCookies: false,
  };
  assertLocalStorage(config.blobConnectionString);
  if (process.env.AzureWebJobsStorage) assertLocalStorage(process.env.AzureWebJobsStorage);
  assertLocalVideo(config);
  return config;
}
module.exports = { getConfig };
