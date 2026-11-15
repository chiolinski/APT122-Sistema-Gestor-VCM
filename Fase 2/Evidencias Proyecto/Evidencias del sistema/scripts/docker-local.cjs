const { spawn } = require("node:child_process");
const { createServer, connect } = require("node:net");
const { once } = require("node:events");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const children = new Set();
const relays = [];

// Conserva los destinos locales de la API y enlaza únicamente los servicios
// fijos del mismo proyecto de Compose. Ningún relay se publica en el host.
async function relay(localPort, host, targetPort) {
  const server = createServer((client) => {
    const target = connect(targetPort, host);
    client.on("error", () => target.destroy());
    target.on("error", () => client.destroy());
    client.on("close", () => target.destroy());
    target.on("close", () => client.destroy());
    client.pipe(target).pipe(client);
  });
  relays.push(server);
  await once(server.listen(localPort, "127.0.0.1"), "listening");
}

function run(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  children.add(child);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      children.delete(child);
      resolve(code ?? 1);
    });
  });
}

function stop() {
  for (const child of children) child.kill();
  for (const server of relays) server.close();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stop();
    process.exit(0);
  });
}

async function main() {
  await Promise.all([
    relay(14333, "sql", 1433),
    ...[10000, 10001, 10002].map((port) => relay(port, "storage", port)),
  ]);

  if (process.argv.includes("--setup")) {
    for (const [command, args] of [
      [process.execPath, ["api/scripts/init-local.js"]],
      ["npm", ["--prefix", "api", "run", "db:migrate"]],
      [process.execPath, ["api/scripts/seed-local.js"]],
    ]) {
      const code = await run(command, args);
      if (code !== 0) return code;
    }
    return 0;
  }

  const code = await Promise.race([
    run("func", ["start", "--port", "7076", "--address", "127.0.0.1"], path.join(root, "api")),
    run(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", "5176", "--strictPort"]),
  ]);
  return code || 1;
}

main().then((code) => {
  stop();
  process.exit(code);
}).catch((error) => {
  console.error(error.message);
  stop();
  process.exit(1);
});
