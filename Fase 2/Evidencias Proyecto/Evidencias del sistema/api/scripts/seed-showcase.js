// Escenario local optativo. Las escrituras operativas pasan por la API real.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { sql, getPool, withTransaction } = require("../src/lib/db");
const { LOCAL_DATABASE } = require("../src/lib/localSafety");
const { getConfig } = require("../src/lib/config");
const { writeAudit } = require("../src/lib/audit");
const { currentDateInChile } = require("../src/lib/coordinationMonitoring");
const { PREFIX, PASSWORD, SCENARIOS, buildShowcase, buildAssignment } = require("./lib/showcase-fixtures");

const ROOT = path.resolve(__dirname, "../..");
const DIRECTORY = path.join(ROOT, ".local/showcase");
const STATE_FILE = path.join(DIRECTORY, "state.json");
const BASE = "http://127.0.0.1:7076";
const WEB = "http://127.0.0.1:5176";
const plan = buildShowcase();
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
let state;
const sessions = new Map();

function saveState() {
  const temporary = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(temporary, STATE_FILE);
}

async function step(key, operation) {
  if (Object.hasOwn(state.steps, key)) return state.steps[key];
  const result = await operation();
  state.steps[key] = result ?? true;
  saveState();
  return state.steps[key];
}

async function api(route, { cookie, token, body, method = "GET", raw, filename, download = false } = {}) {
  assert.ok(route.startsWith("/api/") && !route.includes("#"));
  const response = await fetch(BASE + route, { method, redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { "X-VCM-Link-Token": token } : {}),
      ...(raw ? { "Content-Type": "text/plain;charset=utf-8", "X-File-Name": encodeURIComponent(filename) }
        : body ? { "Content-Type": "application/json" } : {}) },
    ...(raw ? { body: raw } : body ? { body: JSON.stringify(body) } : {}),
  });
  if (download && response.ok) return { data: Buffer.from(await response.arrayBuffer()) };
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${payload.error?.code || ""} ${payload.error?.message || "Fallo de la API local"}`);
  return { data: payload.data, cookie: response.headers.get("set-cookie")?.split(";")[0], payload };
}

async function session(email) {
  if (!sessions.has(email)) {
    const password = email === "admin@example.test" ? process.env.SHOWCASE_ADMIN_PASSWORD || PASSWORD : PASSWORD;
    const result = await api("/api/auth/login", { method: "POST", body: { email, password } });
    assert.ok(result.cookie);
    sessions.set(email, { cookie: result.cookie, principal: result.data });
  }
  return sessions.get(email);
}

const rowKey = (row, keys) => JSON.stringify(keys.map((key) => row[key]));
function rowDigest(row, table) {
  // El ingreso legítimo actualiza sólo estos campos de autenticación del administrador.
  const ignored = table === "Usuario" ? new Set(["ultimo_acceso_en", "actualizado_en", "intentos_fallidos", "bloqueado_hasta"]) : new Set();
  return digest(Object.fromEntries(Object.entries(row).filter(([key]) => !ignored.has(key)).sort(([a], [b]) => a.localeCompare(b))));
}

async function captureExisting(pool) {
  const metadata = (await pool.request().query(`
    SELECT t.name AS tableName, c.name AS columnName, ic.key_ordinal AS ordinal
    FROM sys.tables t INNER JOIN sys.schemas s ON s.schema_id=t.schema_id
    INNER JOIN sys.indexes i ON i.object_id=t.object_id AND i.is_primary_key=1
    INNER JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    INNER JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE s.name='vcm' AND t.name <> 'SesionUsuario' ORDER BY t.name,ic.key_ordinal;
  `)).recordset;
  const tables = [...new Set(metadata.map((row) => row.tableName))];
  const baseline = [];
  for (const table of tables) {
    assert.match(table, /^[A-Za-z0-9_]+$/);
    const keys = metadata.filter((row) => row.tableName === table).map((row) => row.columnName);
    const rows = (await pool.request().query(`SELECT * FROM vcm.[${table}];`)).recordset;
    baseline.push({ table, keys, rows: rows.map((row) => ({ key: rowKey(row, keys), hash: rowDigest(row, table) })) });
  }
  return baseline;
}

async function verifyPreservation(pool) {
  let preserved = 0;
  for (const { table, keys, rows } of state.baseline) {
    assert.match(table, /^[A-Za-z0-9_]+$/);
    const current = (await pool.request().query(`SELECT * FROM vcm.[${table}];`)).recordset;
    const hashes = new Map(current.map((row) => [rowKey(row, keys), rowDigest(row, table)]));
    for (const row of rows) {
      assert.equal(hashes.get(row.key), row.hash, `Cambió o falta un registro previo en ${table}.`);
      preserved += 1;
    }
  }
  return preserved;
}

async function assertFreshNamespace(pool) {
  const existing = await pool.request().query(`
    SELECT correo FROM vcm.Usuario;
    SELECT codigo FROM vcm.Sede;
    SELECT codigo FROM vcm.Asignatura;
    SELECT nombre FROM vcm.Escuela;
    SELECT identificador_fuente,correo FROM vcm.Docente;
    SELECT rut,identificador_externo,correo FROM vcm.Alumno;
    SELECT rut,contacto_correo FROM vcm.SocioFormador;
    SELECT nombre FROM vcm.Proyecto;
  `);
  const compact = (value) => String(value || "").replace(/[.\s-]/g, "").toUpperCase();
  const overlap = (values, wanted, label, normalize = (v) => String(v || "").toLowerCase()) => {
    const keys = new Set(values.map(normalize));
    if (wanted.some((value) => keys.has(normalize(value)))) throw new Error(`Ya existen ${label} del escenario. Se detiene para conservarlos; recupera .local/showcase/state.json para reanudar.`);
  };
  overlap(existing.recordsets[0].map((r) => r.correo), plan.accounts.map((r) => r.email), "cuentas");
  overlap(existing.recordsets[1].map((r) => r.codigo), plan.campuses.map((r) => r.code), "sedes");
  overlap(existing.recordsets[2].map((r) => r.codigo), plan.subjects.map((r) => r.code), "asignaturas");
  overlap(existing.recordsets[3].map((r) => r.nombre), plan.subjects.map((r) => r.schoolName), "escuelas");
  overlap(existing.recordsets[4].flatMap((r) => [r.identificador_fuente, r.correo]), plan.academicRows.flatMap((r) => [r.docente_id, r.docente_correo]), "docentes", compact);
  overlap(existing.recordsets[5].flatMap((r) => [r.rut, r.identificador_externo, r.correo]), plan.academicRows.flatMap((r) => [r.estudiante_rut, r.estudiante_id, r.estudiante_correo]), "estudiantes", compact);
  overlap(existing.recordsets[6].flatMap((r) => [r.rut, r.contacto_correo]), plan.partners.flatMap((r) => [r.taxId, r.contactEmail]), "socios", compact);
  overlap(existing.recordsets[7].map((r) => r.nombre), plan.projects.map((r) => r.name), "proyectos");
  const period = (await pool.request().query("SELECT activo FROM vcm.PeriodoAcademico WHERE codigo='2026-2';")).recordset[0];
  if (period && !period.activo) throw new Error("El período 2026-2 está inactivo; no se reactiva un registro existente.");
}

function generateVideo() {
  const file = path.join(DIRECTORY, "video-ficticio.mp4");
  if (!fs.existsSync(file)) {
    const font = path.join(process.env.WINDIR || "C:/Windows", "Fonts/arial.ttf");
    if (!fs.existsSync(font)) throw new Error("No se encontró Arial para rotular el video ficticio.");
    fs.copyFileSync(font, path.join(DIRECTORY, "font.ttf"));
    const result = spawnSync("ffmpeg", ["-nostdin", "-n", "-f", "lavfi", "-i", "testsrc2=size=480x270:rate=15",
      "-t", "3", "-vf", "drawtext=fontfile=font.ttf:text='VCM LOCAL - VIDEO FICTICIO':fontcolor=white:fontsize=22:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.7",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { cwd: DIRECTORY, encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error(`No se pudo generar el video sintético con ffmpeg: ${result.error?.message || result.stderr?.slice(-500)}`);
  }
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", file], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || JSON.parse(result.stdout).streams[0]?.codec_name !== "h264") throw new Error("El video sintético no pasó ffprobe.");
  return fs.readFileSync(file);
}

async function uploadDocument(project, sectionId, { cookie, principal }) {
  const category = sectionId ? "ENTREGABLE_HITO_2" : "ANTECEDENTE";
  const key = `${project.key}/file/${sectionId || "antecedente"}`;
  return step(key, async () => {
    const query = new URLSearchParams({ category, ...(sectionId ? { sectionId } : {}) });
    const filename = `${project.key}-${sectionId ? "informe-ficticio" : "propuesta-ficticia"}.txt`;
    const raw = Buffer.from(`DATOS COMPLETAMENTE FICTICIOS - VCM LOCAL\n${project.name}\n${project.description}\n${project.expectedResult}\nContacto de prueba: ${project.partnerEmail}\nDocumento demostrativo sin personas ni instituciones reales.\n`, "utf8");
    if (!sectionId) {
      const current = (await api("/api/projects", { cookie })).data
        .find((row) => row.id === project.id && row.databaseId === project.databaseId);
      assert.ok(current, `No se encontró el proyecto ficticio ${project.key}.`);
      for (const file of current.attachments) {
        if (file.name !== filename || file.size !== raw.length
          || String(file.uploadedBy).toLowerCase() !== String(principal.id).toLowerCase()) continue;
        const { data } = await api(`/api/projects/${project.id}/files/${file.id}`, { cookie, download: true });
        if (raw.equals(data)) return { id: file.id, name: file.name, sectionId };
      }
    }
    const result = await api(`/api/projects/${project.id}/files?${query}`, { method: "POST", cookie, raw, filename });
    return { id: result.data.id, name: result.data.name, sectionId };
  });
}

async function deliverVideo(project, sectionId, link, video) {
  return step(`${project.key}/${sectionId}/video/${link.teamId}`, async () => {
    const current = (await api("/api/video-delivery", { token: link.token })).data;
    if (current.deliveredAt) return { filename: current.filename, deliveredAt: current.deliveredAt };
    const attempt = (await api("/api/video-delivery/upload", { method: "POST", token: link.token,
      body: { name: `${project.key}-${link.teamName.replaceAll(" ", "")}-ficticio.mp4`, size: video.length } })).data;
    const target = new URL(attempt.url);
    assert.equal(target.origin, "http://127.0.0.1:10000");
    assert.ok(target.pathname.startsWith("/devstoreaccount1/vcm-local-videos/"));
    const response = await fetch(target, { method: "PUT", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "video/mp4", "If-None-Match": "*" }, body: video });
    if (!response.ok && ![409, 412].includes(response.status)) throw new Error(`Azurite rechazó el video ficticio (${response.status}).`);
    return (await api("/api/video-delivery/confirm", { method: "POST", token: link.token, body: { attemptId: attempt.attemptId } })).data;
  });
}

async function simulateExpiry(review, project, principal) {
  // Excepción explícita de fixtures: simular el tiempo sin relajar la API ni esperar 21 días.
  // Sólo una revisión creada por este ejecutor y perteneciente a su proyecto DEMO26.
  await withTransaction(async (transaction) => {
    const result = await new sql.Request(transaction).input("reviewId", sql.UniqueIdentifier, review.id)
      .input("projectId", sql.UniqueIdentifier, project.databaseId).input("name", sql.NVarChar(220), project.name)
      .input("actorId", sql.UniqueIdentifier, principal.id).query(`
        UPDATE r SET creado_en=DATEADD(day,-22,SYSUTCDATETIME()), vence_en=DATEADD(day,-1,SYSUTCDATETIME())
        FROM vcm.RevisionSocio r INNER JOIN vcm.Proyecto p ON p.proyecto_id=r.proyecto_id
        INNER JOIN vcm.Usuario u ON u.usuario_id=r.creado_por_usuario_id
        WHERE r.revision_socio_id=@reviewId AND p.proyecto_id=@projectId AND p.nombre=@name
          AND p.nombre LIKE 'DEMO26-%' AND r.creado_por_usuario_id=@actorId
          AND u.correo LIKE 'demo.%@example.test' AND r.completado_en IS NULL AND r.revocado_en IS NULL;
      `);
    assert.equal(result.rowsAffected[0], 1, "No se puede simular el vencimiento de una revisión ajena.");
    await new sql.Request(transaction).input("id", sql.UniqueIdentifier, review.id).query(`
      UPDATE vcm.EvaluacionSocioEquipo SET revisado_en=DATEADD(day,-2,SYSUTCDATETIME()) WHERE revision_socio_id=@id;
    `);
    await writeAudit(transaction, principal, { action: "LOCAL_SHOWCASE_REVIEW_EXPIRED", entity: "RevisionSocio", entityId: review.id,
      description: `Vencimiento simulado exclusivamente para el proyecto ficticio ${project.key}.`,
      data: { fixture: PREFIX, projectId: project.databaseId, reason: "Ejemplo local de enlace vencido; no modifica hitos ni respuestas." } }, { required: true });
  });
}

async function populateProject(spec, catalogs, partners, video) {
  const creator = await session(spec.creatorEmail);
  const subject = catalogs.subjects.find((row) => row.code === spec.subjectCode);
  const sections = spec.sections.map((section) => {
    const campus = catalogs.campuses.find((row) => row.code === section.campusCode);
    const found = catalogs.sections.find((row) => row.code === section.code && row.subjectId === subject.id && row.campusId === campus.id);
    assert.ok(found, `No se encontró la sección ${section.code}`);
    return { ...section, id: found.id, campusId: campus.id };
  });
  const created = await step(`${spec.key}/created`, async () => {
    const existing = (await api("/api/projects", { cookie: creator.cookie })).data.find((p) => p.name === spec.name);
    // Recuperación de una respuesta perdida; nunca modifica un proyecto coincidente.
    if (existing) {
      assert.equal(existing.createdBy, creator.principal.id);
      return { id: existing.id, databaseId: existing.databaseId };
    }
    const partner = partners.find((row) => row.contactEmail === spec.partnerEmail);
    const result = (await api("/api/projects", { method: "POST", cookie: creator.cookie,
      body: { name: spec.name, description: spec.description, expectedResult: spec.expectedResult,
        partnerId: partner.id, subjectId: subject.id, campusIds: sections.map((row) => row.campusId), sectionIds: sections.map((row) => row.id) } })).data;
    return { id: result.id, databaseId: result.databaseId };
  });
  const project = { ...spec, ...created, sections };
  await uploadDocument(project, null, creator);
  const stage = spec.scenarioIndex;
  if (stage === 0) return project;

  for (const section of stage === 1 ? sections.slice(0, 1) : sections) {
    const teacher = await session(section.teacherEmail);
    await step(`${spec.key}/${section.id}/hito1`, async () => {
      const projects = (await api("/api/projects", { cookie: teacher.cookie })).data;
      if (projects.find((p) => p.id === project.id)?.sectionStates.find((s) => s.sectionId === section.id)?.milestones[0].status === "Completado") return true;
      const roster = (await api(`/api/projects/${project.id}/roster`, { cookie: teacher.cookie })).data;
      await api(`/api/projects/${project.id}/start`, { method: "POST", cookie: teacher.cookie, body: buildAssignment(roster, section.id) });
      return true;
    });
  }
  if (stage <= 2) return project;
  await step(`${spec.key}/scheduled`, async () => {
    let availableFrom = state.today;
    if (stage === 3) {
      const future = new Date(`${currentDateInChile()}T12:00:00Z`);
      future.setUTCDate(future.getUTCDate() + 7);
      availableFrom = future.toISOString().slice(0, 10);
    } else availableFrom = currentDateInChile();
    await api(`/api/projects/${project.id}/milestones/2/schedule`, { method: "POST", cookie: creator.cookie, body: { availableFrom } });
    return availableFrom;
  });
  if (stage === 3) return project;

  for (const [sectionIndex, section] of sections.entries()) {
    const teacher = await session(section.teacherEmail);
    const route = `/api/projects/${project.id}/sections/${section.id}`;
    await uploadDocument(project, section.id, teacher);
    const links = await step(`${spec.key}/${section.id}/links`, async () => (
      await api(`${route}/video-delivery-links`, { method: "POST", cookie: teacher.cookie })).data);
    if (stage === 4) continue;
    for (const link of stage === 5 ? links.slice(0, 1) : links) await deliverVideo(project, section.id, link, video);
    if (stage === 5) continue;
    const review = await step(`${spec.key}/${section.id}/review`, async () => (
      await api(`${route}/hito2`, { method: "POST", cookie: teacher.cookie })).data);
    if (stage === 6) continue;
    const partial = stage === 7 || stage === 14 || (stage === 8 && spec.repetition % 2 === 0);
    for (const [index, link] of (partial ? links.slice(0, 2) : links).entries()) {
      await step(`${spec.key}/${section.id}/evaluation/${link.teamId}`, async () => {
        await api(`/api/partner-review/teams/${link.teamId}`, { method: "PUT", token: review.token,
          body: { strengths: `Evaluación ficticia: ${link.teamName} presentó una propuesta clara de ${PROJECT_DESCRIPTION(spec)}. Se reconoce la organización del trabajo y la relación con el caso comunitario simulado.`,
            improvements: "Ejemplo ficticio de mejora: reforzar la accesibilidad, explicitar indicadores y realizar una validación adicional con participantes simulados.",
            rating: 3 + (spec.number + index + sectionIndex) % 3 } });
        return true;
      });
    }
    if (stage === 7) continue;
    if (stage === 14) {
      await step(`${spec.key}/${section.id}/expired`, async () => {
        await simulateExpiry(review, project, teacher.principal);
        return true;
      });
      continue;
    }
    if (stage === 15) {
      await step(`${spec.key}/${section.id}/revoked`, async () => {
        await api(`/api/projects/${project.id}/partner-reviews/${review.id}`, { method: "DELETE", cookie: creator.cookie });
        return true;
      });
      continue;
    }
    await step(`${spec.key}/${section.id}/feedback`, async () => {
      if (partial) await api(`${route}/hito2/close-review`, { method: "POST", cookie: teacher.cookie, body: { reviewId: review.id } });
      else await api("/api/partner-review/complete", { method: "POST", token: review.token });
      return true;
    });
    if (stage === 8 || (stage === 9 && sectionIndex > 0)) continue;
    await step(`${spec.key}/${section.id}/hito2`, async () => {
      const current = (await api(`${route}/hito2`, { cookie: teacher.cookie })).data;
      if (current.closed) return true;
      await api(`/api/projects/${project.id}/progress`, { method: "POST", cookie: teacher.cookie,
        body: { sectionId: section.id, reviewId: review.id, feedbackReviewed: true,
          advance: `Avance ficticio de ${spec.key}: se entregó el prototipo y se revisaron las evaluaciones de los tres equipos de la sección ${section.code}.`,
          conclusions: "Conclusión de demostración: los resultados son simulados. Se identificaron mejoras de accesibilidad, documentación y validación que quedan registradas para el cierre académico." } });
      return true;
    });
    if (stage < 11 || (stage === 11 && sectionIndex > 0)) continue;
    await step(`${spec.key}/${section.id}/hito3`, async () => {
      const ownProjects = (await api("/api/projects", { cookie: teacher.cookie })).data;
      if (ownProjects.find((p) => p.id === project.id)?.sectionStates.find((s) => s.sectionId === section.id)?.milestones[2].status === "Completado") return true;
      await api(`/api/projects/${project.id}/close`, { method: "POST", cookie: teacher.cookie, body: { sectionId: section.id } });
      return true;
    });
  }
  if (stage === 13) {
    await step(`${spec.key}/reopened`, async () => {
      await api(`/api/projects/${project.id}/milestones/2/reopen`, { method: "POST", cookie: creator.cookie,
        body: { sectionId: sections[0].id, reason: "Reapertura ficticia DEMO26 para ejemplificar una corrección docente con trazabilidad y auditoría." } });
      return true;
    });
  }
  return project;
}

function PROJECT_DESCRIPTION(spec) {
  return plan.subjects.find((subject) => subject.code === spec.subjectCode).name.toLowerCase();
}

function writeGuide(projects) {
  const lines = ["# Demostración local DEMO26", "", `Generada: ${currentDateInChile()}. Todos los datos son ficticios.`, "",
    `Abrir ${WEB}. Contraseña inicial de las cuentas nuevas: ${PASSWORD}.`, "",
    "## Cuentas de acceso", "", "| Categoría | Correos | Cantidad |", "| --- | --- | ---: |",
    "| Administradores | demo.admin001@example.test a demo.admin005@example.test | 5 |",
    "| Coordinadores CITT | demo.coordinacion001@example.test a demo.coordinacion020@example.test | 20 |",
    "| Directores | demo.direccion001@example.test a demo.direccion025@example.test | 25 |",
    "| Docentes | demo.docente001@example.test a demo.docente200@example.test | 200 |", "",
    "Los coordinadores 001 a 010 tienen también docencia asignada. Las cinco cuentas originales se conservan.", "",
    "## Proyectos por escenario", "", "| Escenario | Proyecto | Docente / coordinador docente |", "| --- | --- | --- |"];
  for (const project of projects) lines.push(`| ${project.scenarioLabel} | [${project.id} · ${project.key}](${WEB}/app/proyectos/${project.id}) | ${project.sections.map((section) => section.teacherEmail).join(" / ")} |`);
  lines.push("", "## Enlaces temporales de ejemplo", "", "Cada enlace da acceso sólo a su equipo o revisión. Los vencidos o revocados muestran el rechazo esperado.", "");
  for (const scenario of SCENARIOS.slice(4)) {
    const project = projects.find((p) => p.scenario === scenario.key);
    const section = project.sections[0];
    const links = state.steps[`${project.key}/${section.id}/links`];
    const review = state.steps[`${project.key}/${section.id}/review`];
    lines.push(`### ${project.id} · ${project.scenarioLabel}`, "", `Docente: ${section.teacherEmail}`, "");
    if (links?.[0]) lines.push(`[Entrega de ${links[0].teamName}](${WEB}/entrega-video#${links[0].token})`, "");
    if (review) lines.push(`[Revisión del socio](${WEB}/revision-socio#${review.token})`, "");
  }
  fs.writeFileSync(path.join(DIRECTORY, "GUIA.md"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(DIRECTORY, "cuentas.csv"), "correo;nombre;rol;cargo\n" + plan.accounts.map((a) => [a.email, a.name, a.role, a.title].join(";")).join("\n") + "\n");
}

async function verifyShowcase(pool, adminCookie, projects, strict) {
  const preserved = await verifyPreservation(pool);
  const users = (await api("/api/users", { cookie: adminCookie })).data;
  for (const account of plan.accounts) assert.ok(users.some((user) => user.email === account.email), `Falta la cuenta ${account.email}`);
  const allProjects = (await api("/api/projects", { cookie: adminCookie })).data;
  for (const project of projects) {
    const current = allProjects.find((p) => p.id === project.id);
    assert.ok(current);
    assert.equal(current.sectionStates.length, 3);
    if (!strict) continue; // Una segunda ejecución conserva los avances realizados por el usuario.
    const stage = project.scenarioIndex;
    const completed = [0, 1, 2].map((index) => current.sectionStates.filter((s) => s.milestones[index].status === "Completado").length);
    assert.deepEqual(completed, stage === 0 ? [0, 0, 0] : stage === 1 ? [1, 0, 0] : stage <= 8 || stage >= 14 ? [3, 0, 0]
      : stage === 9 ? [3, 1, 0] : stage === 10 ? [3, 3, 0] : stage === 11 ? [3, 3, 1] : stage === 12 ? [3, 3, 3] : [3, 2, 2], project.key);
    assert.equal(current.status, stage === 0 ? "Planificado" : stage === 12 ? "Finalizado" : "En ejecución");
    for (const [index, milestone] of current.milestones.entries()) assert.equal(milestone.status === "Completado", completed[index] === 3, `Consolidación global ${project.key}`);
  }
  const counts = (await pool.request().query(`
    SELECT (SELECT COUNT(*) FROM vcm.Usuario) AS users, (SELECT COUNT(*) FROM vcm.Alumno) AS students,
      (SELECT COUNT(*) FROM vcm.SocioFormador) AS partners, (SELECT COUNT(*) FROM vcm.Proyecto) AS projects,
      (SELECT COUNT(*) FROM vcm.Equipo) AS teams, (SELECT COUNT(*) FROM vcm.ArchivoProyecto) AS files,
      (SELECT COUNT(*) FROM vcm.EntregaVideoEquipo WHERE blob_confirmado IS NOT NULL) AS videos;
  `)).recordset[0];
  const { BlobServiceClient } = require("@azure/storage-blob");
  const config = getConfig();
  const service = BlobServiceClient.fromConnectionString(config.blobConnectionString);
  for (const name of [config.blobContainerName, config.videoContainerName]) assert.ok(!(await service.getContainerClient(name).getProperties()).blobPublicAccess);
  return { counts, preservedOriginalRows: preserved, scenarios: SCENARIOS.map((s) => ({ scenario: s.label, projects: projects.filter((p) => p.scenario === s.key).length })) };
}

async function main() {
  fs.mkdirSync(DIRECTORY, { recursive: true });
  const health = (await api("/api/health")).payload;
  assert.equal(health.status, "ok");
  assert.equal(health.database.databaseName, LOCAL_DATABASE);
  const pool = await getPool();
  try {
    await withTransaction(async (transaction) => {
      // SQL libera el bloqueo al terminar la transacción o desconectarse el proceso.
      const result = await new sql.Request(transaction).query(`
        DECLARE @result int;
        EXEC @result = sys.sp_getapplock @Resource = N'VCM:DEMO26', @LockMode = 'Exclusive',
          @LockOwner = 'Transaction', @LockTimeout = 0;
        SELECT @result AS code;
      `);
      const code = result.recordset[0].code;
      if (code === -1) throw new Error("Ya hay una carga DEMO26 en ejecución.");
      assert.ok(code >= 0, `No se pudo reservar la carga DEMO26 (SQL ${code}).`);
      await runShowcase(pool);
    });
  } finally {
    for (const value of sessions.values()) await api("/api/auth/logout", { method: "POST", cookie: value.cookie }).catch(() => {});
    await pool.close();
  }
}

async function runShowcase(pool) {
  const admin = await session("admin@example.test");
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    assert.equal(state.planHash, digest(plan), "La receta cambió; no se modifica un escenario ya creado con otra receta.");
  } else {
    await assertFreshNamespace(pool);
    state = { version: 1, planHash: digest(plan), database: LOCAL_DATABASE, today: currentDateInChile(),
      baseline: await captureExisting(pool), steps: {}, complete: false };
    saveState();
  }
  if (state.complete) {
    const report = await verifyShowcase(pool, admin.cookie, state.projects, false);
    console.log("Escenario ya creado. No se escribieron ni restablecieron datos de demostración.");
    console.log(JSON.stringify(report.counts));
    return;
  }
  const video = generateVideo();
  await step("academic-import", async () => {
    const preview = (await api("/api/academic-imports/preview", { method: "POST", cookie: admin.cookie, body: { rows: plan.academicRows } })).data;
    assert.equal(preview.canApply, true, JSON.stringify(preview.issues));
    const result = (await api("/api/academic-imports/apply", { method: "POST", cookie: admin.cookie,
      body: { filename: "academic-showcase-DEMO26.json", rows: plan.academicRows } })).data;
    return { id: result.id, summary: result.summary };
  });
  console.log("Carga académica ficticia aplicada: 240 secciones y 2.880 estudiantes.");
  for (const [index, account] of plan.accounts.entries()) {
    await step(`account/${account.email}`, async () => {
      const users = (await api("/api/users", { cookie: admin.cookie })).data;
      const existing = users.find((user) => user.email === account.email);
      if (existing) { assert.equal(existing.role, account.role.toLowerCase()); return { id: existing.id }; }
      const result = (await api("/api/users", { method: "POST", cookie: admin.cookie, body: { ...account, password: PASSWORD } })).data;
      return { id: result.id };
    });
    if ((index + 1) % 25 === 0) console.log(`Cuentas ficticias preparadas: ${index + 1}/250.`);
  }
  for (const partner of plan.partners) {
    await step(`partner/${partner.contactEmail}`, async () => {
      const partners = (await api("/api/partners", { cookie: admin.cookie })).data;
      const existing = partners.find((row) => row.contactEmail === partner.contactEmail);
      if (existing) return { id: existing.id };
      return { id: (await api("/api/partners", { method: "POST", cookie: admin.cookie, body: partner })).data.id };
    });
  }
  const catalogs = (await api("/api/academic-catalogs", { cookie: admin.cookie })).data;
  const partners = (await api("/api/partners", { cookie: admin.cookie })).data;
  const projects = [];
  for (const spec of plan.projects) {
    projects.push(await populateProject(spec, catalogs, partners, video));
    console.log(`Proyecto ${projects.length}/80: ${spec.key} · ${spec.scenarioLabel}.`);
  }
  writeGuide(projects);
  const report = await verifyShowcase(pool, admin.cookie, projects, true);
  state.projects = projects;
  state.report = report;
  state.complete = true;
  state.completedAt = new Date().toISOString();
  saveState();
  console.log("Escenario completo; registros anteriores conservados y estados de hitos comprobados.");
  console.log(JSON.stringify(report, null, 2));
  console.log("Guía y enlaces de prueba: .local/showcase/GUIA.md");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
