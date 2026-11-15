const { performance } = require("node:perf_hooks");

const args = process.argv.slice(2);
const useDocker = args.includes("--docker");
const base = useDocker ? "http://127.0.0.1:5176/api" : "http://127.0.0.1:7076/api";
const budgets = [
  { name: "Salud SQL", path: "/health", samples: 24, concurrency: 4, maxP95: 750 },
  { name: "Seguimiento", path: "/projects/monitoring", samples: 24, concurrency: 4, maxP95: 2500 },
  { name: "Excel de proyectos finalizados", path: "/projects/monitoring/export?scope=finished", samples: 8, concurrency: 2, maxP95: 6000 },
];

function request(path, options = {}) {
  return fetch(base + path, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) });
}

async function runSample({ name, path }, cookie) {
  const start = performance.now();
  const response = await request(path, { headers: { cookie } });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  if (path.includes("/export")) {
    if (!response.headers.get("content-type")?.includes("spreadsheetml.sheet") || body.subarray(0, 4).toString("hex") !== "504b0304") {
      throw new Error(`${name}: la respuesta no es un Excel válido.`);
    }
  } else {
    const payload = JSON.parse(body.toString());
    if (path === "/health" && (payload.status !== "ok" || payload.database?.databaseName !== "vcm_piloto_2026_local")) {
      throw new Error(`${name}: la base de pruebas no está disponible.`);
    }
    if (path === "/projects/monitoring" && !Array.isArray(payload.data?.projects)) {
      throw new Error(`${name}: faltan los proyectos en la respuesta.`);
    }
  }
  return performance.now() - start;
}

async function measure(budget, cookie) {
  await runSample(budget, cookie);
  const times = [];
  const errors = [];
  let nextSample = 0;
  const workers = Array.from({ length: budget.concurrency }, async () => {
    while (nextSample++ < budget.samples) {
      try { times.push(await runSample(budget, cookie)); }
      catch (error) { errors.push(error.message); }
    }
  });
  await Promise.all(workers);
  times.sort((a, b) => a - b);
  const p95 = times.length ? Math.round(times[Math.ceil(times.length * 0.95) - 1]) : null;
  return {
    ruta: budget.name,
    solicitudes: budget.samples,
    concurrencia: budget.concurrency,
    p95Ms: p95,
    limiteMs: budget.maxP95,
    errores: errors.length,
    primerError: errors[0] || "",
    aprobado: !errors.length && p95 <= budget.maxP95,
  };
}

async function main() {
  if (args.some((arg) => arg !== "--docker")) throw new Error("Uso: npm run test:performance [-- --docker]");
  await runSample(budgets[0], "");
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.test",
      password: process.env.VCM_TEST_ADMIN_PASSWORD || "LocalVCM2026!",
    }),
  });
  await login.arrayBuffer();
  const session = login.headers.getSetCookie().find((value) => value.startsWith("vcm_local_session="));
  if (!login.ok || !session) throw new Error("No se pudo iniciar sesión con la cuenta ficticia admin@example.test.");
  const cookie = session.split(";")[0];
  try {
    const results = [];
    for (const budget of budgets) results.push(await measure(budget, cookie));
    console.table(results);
    if (results.some((result) => !result.aprobado)) process.exitCode = 1;
  } finally {
    const logout = await request("/auth/logout", { method: "POST", headers: { cookie } });
    await logout.arrayBuffer();
    if (!logout.ok) throw new Error("No se pudo revocar la sesión de la prueba.");
  }
}

main().catch((error) => {
  console.error(`Prueba de rendimiento local: ${error.message}`);
  process.exitCode = 1;
});
