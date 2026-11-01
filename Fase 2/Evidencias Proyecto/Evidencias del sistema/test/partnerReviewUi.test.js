import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Render the real components and API client, without real users, SQL or storage writes.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://review.example.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => { callback(0); return 0; };
// jsdom does not implement native dialog modality; browsers provide focus trapping
// and background inertness. Simulate only the open/close state for component tests.
Object.defineProperties(window.HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute("open", ""); } },
  close: { configurable: true, value() { this.removeAttribute("open"); } },
});
const React = await import("react");
const { MemoryRouter } = await import("react-router-dom");
const { render, screen, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
const require = createRequire(import.meta.url);

async function component(relativePath) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const { outputFiles } = await build({ entryPoints: [filename], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env.DEV": "false" } });
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.require = require;
  compiled._compile(outputFiles[0].text, filename);
  return compiled.exports.default;
}

const ReviewPage = await component("../src/pages/PartnerReviewPage.jsx");
const ReviewManager = await component("../src/components/PartnerReviewManager.jsx");
const HitoTwoPanel = await component("../src/components/HitoTwoPanel.jsx");
const BulkClosure = await component("../src/components/BulkPartnerReviewClosure.jsx");
const StudentVideoDeliveryPage = await component("../src/pages/StudentVideoDeliveryPage.jsx");
const TOKEN = "A".repeat(43);
const now = "2026-10-20T15:00:00Z";
const response = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: { message: data } }), {
  status, headers: { "Content-Type": "application/json" },
});
const reviewData = () => ({ id: "review-1", partnerName: "Fundación Prueba", contactName: "María Pérez",
  projectName: "Proyecto de prueba", subjectName: "Desarrollo de aplicaciones móviles", campusName: "Concepción",
  sectionCode: "001D", teacherName: "Docente de prueba", period: "2026-2", reviewDate: "2026-10-20",
  teams: [{ id: "team-1", name: "Equipo 1" }, { id: "team-2", name: "Equipo 2" }], evaluations: [], completedAt: null });

function session(hash = TOKEN) {
  return render(React.createElement(MemoryRouter, { initialEntries: [`/revision-socio${hash ? `#${hash}` : ""}`] },
    React.createElement(ReviewPage)));
}

function mockReviewApi(t, data = reviewData()) {
  const state = { data, calls: [], failSave: false, failComplete: false, completeGate: null };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    state.calls.push({ url, options });
    assert.ok(!url.includes(TOKEN), "the bearer secret must never enter API URLs");
    assert.equal(options.headers["X-VCM-Link-Token"], TOKEN);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.cache, "no-store");
    if (url === "/api/partner-review") return response(state.data);
    if (url.endsWith("/video")) return response(url.includes("team-1")
      ? { status: "available", url: "https://video.example.test/Videoequipo1.mp4", filename: "Videoequipo1.mp4", expiresAt: null }
      : { status: "pending", url: null });
    if (options.method === "PUT") {
      if (state.failSave) return response("Error temporal al guardar", 503);
      const teamId = url.split("/").at(-1);
      const evaluation = { ...JSON.parse(options.body), teamId, reviewedAt: now };
      state.data = { ...state.data, evaluations: [...state.data.evaluations.filter((item) => item.teamId !== teamId), evaluation] };
      return response(evaluation);
    }
    if (url.endsWith("/complete")) {
      if (state.completeGate) await state.completeGate;
      if (state.failComplete) return response("No se pudo finalizar. Intenta nuevamente.", 503);
      state.data = { ...state.data, completedAt: now };
      return response({ completedAt: now });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  return state;
}

function fill(strengths = "Propuesta útil", improvements = "Mejorar la navegación") {
  fireEvent.change(screen.getByRole("textbox", { name: /Fortalezas observadas/ }), { target: { value: strengths } });
  fireEvent.change(screen.getByRole("textbox", { name: /Observaciones/ }), { target: { value: improvements } });
  fireEvent.click(screen.getByRole("radio", { name: "4 estrellas" }));
}

afterEach(() => cleanup());

const bulkPreview = () => ({ period: "2026-2", generatedAt: now, revision: "a".repeat(64),
  summary: { links: 3, withFeedback: 1, withoutFeedback: 1, alreadyCompleted: 1, evaluations: 4 },
  records: [{ id: "review-1", projectCode: "VCM-2026-142", campusName: "Maipú", subjectCode: "DSY1105", sectionCode: "008D", evaluatedCount: 2, totalTeams: 20, outcome: "withFeedback" },
    { id: "review-2", projectCode: "VCM-2026-143", campusName: "San Joaquín", subjectCode: "DSY1105", sectionCode: "002D", evaluatedCount: 0, totalTeams: 20, outcome: "withoutFeedback" },
    { id: "review-3", projectCode: "VCM-2026-144", campusName: "Maipú", subjectCode: "DSY1105", sectionCode: "003D", evaluatedCount: 2, totalTeams: 2, outcome: "alreadyCompleted" }] });
function mockBulk(t) {
  const state = { writes: 0, gate: null, failure: null, bodies: [] };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.cache, "no-store");
    if (url.endsWith("/periods")) return response([{ code: "2026-2" }, { code: "2026-1" }]);
    if (url.endsWith("/preview")) return response({ ...bulkPreview(), period: JSON.parse(options.body).period });
    if (url === "/api/partner-reviews/bulk-close") {
      state.writes++; state.bodies.push(JSON.parse(options.body));
      if (state.gate) await state.gate;
      if (state.failure) return new Response(JSON.stringify({ error: state.failure }), { status: 409 });
      return response({ period: "2026-2", summary: bulkPreview().summary });
    }
    throw new Error(`Unexpected bulk request ${url}`);
  });
  return state;
}
async function openBulkPreview() {
  render(React.createElement(BulkClosure));
  await screen.findByRole("option", { name: "2026-2" });
  fireEvent.change(screen.getByRole("combobox", { name: "Período académico" }), { target: { value: "2026-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar enlaces" }));
  await screen.findByRole("heading", { name: "Enlaces del período 2026-2" });
}

test("el cierre masivo exige dos ventanas centradas y permite cancelar en ambas sin escribir", async (t) => {
  const api = mockBulk(t); await openBulkPreview();
  assert.ok(screen.getByText("Cerrar sin respuestas"));
  const trigger = screen.getByRole("button", { name: "Cerrar enlaces del período" });
  trigger.focus(); fireEvent.click(trigger);
  assert.equal(api.writes, 0);
  assert.match(screen.getByRole("dialog").textContent, /Primera confirmación/);
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Volver a la vista previa" }));
  fireEvent.click(screen.getByRole("button", { name: "Volver a la vista previa" }));
  assert.equal(screen.queryByRole("dialog"), null); assert.equal(document.activeElement, trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Continuar a la segunda confirmación" }));
  assert.ok(screen.getByRole("dialog", { name: "Confirmación final · 2026-2" }));
  assert.equal(api.writes, 0);
  fireEvent(screen.getByRole("dialog"), new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.queryByRole("dialog"), null); assert.equal(api.writes, 0);
});

test("la segunda confirmación envía un único cierre, bloquea Escape mientras guarda y muestra resultado", async (t) => {
  const api = mockBulk(t); let release;
  api.gate = new Promise((resolve) => { release = resolve; });
  await openBulkPreview();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar enlaces del período" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar a la segunda confirmación" }));
  const confirm = screen.getByRole("button", { name: "Sí, cerrar los enlaces" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  assert.equal(api.writes, 1);
  assert.equal(screen.getByRole("button", { name: "Cancelar cierre masivo" }).disabled, true);
  fireEvent(screen.getByRole("dialog"), new window.Event("cancel", { cancelable: true }));
  assert.ok(screen.getByRole("dialog"));
  release();
  await screen.findByRole("status");
  assert.match(screen.getByRole("status").textContent, /Hito 2 permanece sin cambios/);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(screen.queryByRole("button", { name: "Cerrar enlaces del período" }), null);
  assert.deepEqual(api.bodies[0], { period: "2026-2", generatedAt: now, revision: "a".repeat(64), confirmed: true, confirmation: "2026-2" });
});

test("un cambio concurrente elimina la vista previa y exige volver a confirmar", async (t) => {
  const api = mockBulk(t); api.failure = { code: "BULK_PREVIEW_CHANGED", message: "Las respuestas cambiaron. Actualiza la vista previa." };
  await openBulkPreview();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar enlaces del período" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar a la segunda confirmación" }));
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar los enlaces" }));
  await screen.findByRole("alert");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(screen.queryByRole("button", { name: "Cerrar enlaces del período" }), null);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-1" } });
  assert.equal(screen.queryByRole("alert"), null);
  assert.equal(api.writes, 1);
});

test("una revisión cerrada sin respuestas no muestra promedio ni permite cerrar Hito 2", async (t) => {
  const state = { sectionId: "s1", videos: [], feedbackReady: false, teamsChanged: false, canManageReviewClosure: false,
    review: { id: "r1", completedAt: now, deliveredAt: now, closedInternally: true, closedByName: "Administración", evaluatedCount: 0,
      teams: [{ id: "team-1", name: "Equipo 1" }], evaluations: [] } };
  t.mock.method(globalThis, "fetch", async () => response(state));
  render(React.createElement(HitoTwoPanel, { projectId: "VCM-2026-142", section: { id: "s1", code: "008D" }, progress: {}, setProgress: () => {}, onSubmit: () => {} }));
  await screen.findByRole("heading", { name: "Cerrada sin respuestas · Sección 008D" });
  assert.ok(screen.getByText(/Sin valoración promedio/));
  assert.equal(screen.queryByRole("button", { name: "Cerrar Hito 2 de mi sección" }), null);
  assert.equal(screen.queryByText("/5"), null);
});

test("la revisión guarda por equipo, conserva borradores y confirma el cierre de sólo lectura", async (t) => {
  const api = mockReviewApi(t);
  t.mock.method(window, "confirm", () => { throw new Error("No debe abrirse una alerta del navegador"); });
  const view = session();
  await screen.findByRole("heading", { name: "Equipo 1" });
  await waitFor(() => assert.equal(screen.getByLabelText("Video de Equipo 1").getAttribute("src"), "https://video.example.test/Videoequipo1.mp4"));
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Ver resumen" }));
  assert.equal(screen.getByRole("button", { name: "Finalizar revisión" }).disabled, true);
  fireEvent.click(screen.getAllByRole("button", { name: "Evaluar", exact: true })[0]);
  assert.equal(screen.getByRole("textbox", { name: /Fortalezas/ }).value, "Propuesta útil");
  fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
  await screen.findByRole("heading", { name: "Equipo 2" });
  await screen.findByRole("button", { name: "Buscar nuevamente" });
  fill("Buena presentación", "Sin observaciones adicionales");
  fireEvent.click(screen.getByRole("button", { name: "Guardar y revisar resumen" }));
  await screen.findByRole("heading", { name: "Revisa tus evaluaciones" });
  assert.equal(api.data.evaluations.length, 2);
  assert.equal(screen.getByRole("button", { name: "Finalizar revisión" }).disabled, false);

  // Saved work is recovered from the API when reopening the same link.
  view.unmount();
  session();
  await screen.findByRole("heading", { name: "Revisa tus evaluaciones" });
  fireEvent.click(screen.getAllByRole("button", { name: "Editar", exact: true })[0]);
  fireEvent.change(screen.getByRole("textbox", { name: /Fortalezas/ }), { target: { value: "Cambio pendiente" } });
  fireEvent.click(screen.getByRole("button", { name: "Ver resumen" }));
  assert.equal(screen.getByRole("button", { name: "Finalizar revisión" }).disabled, true);
  fireEvent.click(screen.getAllByRole("button", { name: "Editar", exact: true })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
  await screen.findByRole("heading", { name: "Equipo 2" });
  fireEvent.click(screen.getByRole("button", { name: "Ver resumen" }));
  fireEvent.click(screen.getByRole("button", { name: "Finalizar revisión" }));
  await screen.findByRole("dialog", { name: "¿Finalizar tu revisión?" });
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Seguir revisando" }));
  assert.equal(api.calls.filter(({ url }) => url.endsWith("/complete")).length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Seguir revisando" }));
  assert.equal(screen.queryByRole("dialog"), null);
  fireEvent.click(screen.getByRole("button", { name: "Finalizar revisión" }));
  fireEvent.click(screen.getByRole("button", { name: "Sí, finalizar revisión" }));
  await screen.findByRole("heading", { name: "Tu revisión quedó registrada" });
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(api.calls.filter(({ url }) => url.endsWith("/complete")).length, 1);
  fireEvent.click(screen.getAllByRole("button", { name: "Ver evaluación" })[0]);
  assert.equal(screen.getByRole("textbox", { name: /Fortalezas/ }).value, "Cambio pendiente");
  assert.equal(screen.getByRole("textbox", { name: /Fortalezas/ }).disabled, true);
  assert.equal(screen.getByRole("radio", { name: "4 estrellas" }).matches(":disabled"), true);
  assert.equal(screen.queryByRole("button", { name: "Guardar y continuar" }), null);
});

test("los errores de video y guardado no borran comentarios y permiten reintentar", async (t) => {
  const api = mockReviewApi(t);
  api.failSave = true;
  session();
  await screen.findByRole("heading", { name: "Equipo 1" });
  const video = await screen.findByLabelText("Video de Equipo 1");
  fill();
  fireEvent.error(video);
  await screen.findByRole("button", { name: "Volver a cargar" });
  fireEvent.click(screen.getByRole("button", { name: "Volver a cargar" }));
  await screen.findByLabelText("Video de Equipo 1");
  assert.equal(screen.getByRole("textbox", { name: /Fortalezas/ }).value, "Propuesta útil");
  fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
  await screen.findByText("Error temporal al guardar");
  assert.equal(api.data.evaluations.length, 0);
  assert.equal(screen.getByRole("textbox", { name: /Observaciones/ }).value, "Mejorar la navegación");
  api.failSave = false;
  fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
  await screen.findByRole("heading", { name: "Equipo 2" });
  assert.equal(api.data.evaluations.length, 1);
});

function savedReview() {
  const data = reviewData();
  data.evaluations = data.teams.map(({ id }) => ({ teamId: id, strengths: "Fortalezas guardadas", improvements: "Mejoras guardadas", rating: 4 }));
  return data;
}

test("Escape cancela el cuadro sin finalizar y devuelve el foco al botón de origen", async (t) => {
  const api = mockReviewApi(t, savedReview());
  const previousOverflow = document.body.style.overflow;
  session();
  const trigger = await screen.findByRole("button", { name: "Finalizar revisión" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "¿Finalizar tu revisión?" });
  assert.equal(document.body.style.overflow, "hidden");
  assert.match(dialog.textContent, /ya no podrás modificar tus comentarios ni valoraciones/);
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, trigger);
  assert.equal(document.body.style.overflow, previousOverflow);
  assert.equal(api.calls.filter(({ url }) => url.endsWith("/complete")).length, 0);
});

test("el cuadro bloquea dobles envíos mientras finaliza y permite reintentar un error sin perder evaluaciones", async (t) => {
  const api = mockReviewApi(t, savedReview());
  let release;
  api.completeGate = new Promise((resolve) => { release = resolve; });
  api.failComplete = true;
  session();
  fireEvent.click(await screen.findByRole("button", { name: "Finalizar revisión" }));
  const confirm = screen.getByRole("button", { name: "Sí, finalizar revisión" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  const dialog = screen.getByRole("dialog");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(screen.getByRole("button", { name: "Seguir revisando" }).disabled, true);
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.getByRole("dialog"), dialog);
  assert.equal(api.calls.filter(({ url }) => url.endsWith("/complete")).length, 1);
  release();
  await screen.findByRole("alert");
  assert.match(dialog.textContent, /No se pudo finalizar/);
  assert.equal(api.data.completedAt, null);
  assert.equal(api.data.evaluations.length, 2);
  api.failComplete = false;
  api.completeGate = null;
  fireEvent.click(screen.getByRole("button", { name: "Sí, finalizar revisión" }));
  await screen.findByRole("heading", { name: "Tu revisión quedó registrada" });
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(api.calls.filter(({ url }) => url.endsWith("/complete")).length, 2);
});

test("un enlace incompleto no consulta la API y uno rechazado no muestra contexto privado", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return response("Enlace no disponible", 404); });
  const view = session("");
  await screen.findByRole("alert");
  assert.match(screen.getByRole("alert").textContent, /enlace está incompleto/);
  assert.equal(calls.length, 0);
  view.unmount();
  session();
  await screen.findByText("Enlace no disponible");
  assert.equal(screen.queryByText("Fundación Prueba"), null);
  assert.equal(screen.queryByRole("textbox"), null);
});

test("el panel confirma reemplazos y revocaciones, conserva el enlace ante un error y las respuestas al revocar", async (t) => {
  let reviews = [];
  const calls = [];
  let failCreate = false;
  let confirmed = false;
  const confirmations = [];
  t.mock.method(window, "confirm", (message) => { confirmations.push(message); return confirmed; });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (!options.method) return response(reviews);
    if (options.method === "POST") {
      if (failCreate) return response("No se pudo crear la revisión", 503);
      reviews = [{ ...reviewData(), sectionId: "section-1", active: true, createdAt: now, expiresAt: "2027-01-18T15:00:00Z",
        evaluations: [{ teamId: "team-1", strengths: "Respuesta preservada", improvements: "Mejora", rating: 4, reviewedAt: now }] }];
      return response({ id: "review-1", token: TOKEN, expiresAt: reviews[0].expiresAt });
    }
    if (options.method === "DELETE") return response({ revoked: true });
    throw new Error(`Unexpected test request: ${url}`);
  });
  render(React.createElement(ReviewManager, { projectId: "project-1", sections: [{ id: "section-1", campusName: "Concepción", code: "001D" }] }));
  const create = await screen.findByRole("button", { name: "Crear enlace de revisión" });
  await waitFor(() => assert.equal(create.disabled, false));
  fireEvent.click(create);
  const link = await screen.findByRole("textbox", { name: /Enlace exclusivo/ });
  assert.equal(link.value, `https://review.example.test/revision-socio#${TOKEN}`);
  await screen.findByText("Respuesta preservada");
  fireEvent.click(screen.getByRole("button", { name: "Crear nueva revisión y enlace" }));
  assert.equal(calls.filter(({ options }) => options.method === "POST").length, 1);
  confirmed = true;
  failCreate = true;
  fireEvent.click(screen.getByRole("button", { name: "Crear nueva revisión y enlace" }));
  await screen.findByText("No se pudo crear la revisión");
  assert.equal(screen.getByRole("textbox", { name: /Enlace exclusivo/ }).value, link.value);
  confirmed = false;
  fireEvent.click(screen.getByRole("button", { name: "Revocar enlace" }));
  assert.equal(calls.filter(({ options }) => options.method === "DELETE").length, 0);
  confirmed = true;
  fireEvent.click(screen.getByRole("button", { name: "Revocar enlace" }));
  await screen.findByText("El enlace fue revocado. Las evaluaciones recibidas se conservan.");
  assert.equal(calls.filter(({ options }) => options.method === "DELETE").length, 1);
  assert.equal(screen.queryByRole("textbox", { name: /Enlace exclusivo/ }), null);
  assert.ok(screen.getByText("Respuesta preservada"));
  assert.equal(confirmations.length, 4);
});

const hitoState = () => ({ sectionId: "section-1", closed: false, feedbackReviewedAt: null, teamsChanged: false,
  canPublish: true, canReceiveVideos: true, feedbackReady: false, review: null,
  videos: [{ id: "team-1", name: "Equipo 1", status: "available" }] });
const panelProps = () => ({ projectId: "project-1", section: { id: "section-1", code: "001D" }, closed: false,
  progress: { advance: "Avance", conclusions: "Conclusiones" }, setProgress: () => {}, saving: false, onSubmit: () => {} });

test("Hito 2 registra la fase de videos, entrega el enlace al socio y no habilita el cierre con respuestas parciales", async (t) => {
  let state = hitoState();
  const posts = [];
  t.mock.method(window, "confirm", () => { throw new Error("La entrega de videos no debe usar la alerta del navegador"); });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!options.method) return response(state);
    posts.push(url);
    state = { ...state, canReceiveVideos: false, review: { id: "review-1", deliveredAt: now, expiresAt: "2027-01-18T15:00:00Z", completedAt: null,
      teams: [{ id: "team-1", name: "Equipo 1" }], evaluatedCount: 1, evaluations: [] } };
    return response({ id: "review-1", token: TOKEN });
  });
  render(React.createElement(HitoTwoPanel, panelProps()));
  const publish = await screen.findByRole("button", { name: "Registrar videos y solicitar retroalimentación" });
  publish.focus();
  fireEvent.click(publish);
  await screen.findByRole("dialog", { name: "¿Registrar los videos y solicitar retroalimentación?" });
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Volver a los videos" }));
  assert.deepEqual(posts, []);
  fireEvent.click(screen.getByRole("button", { name: "Volver a los videos" }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, publish);
  fireEvent.click(publish);
  fireEvent(screen.getByRole("dialog"), new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(posts, []);
  fireEvent.click(publish);
  fireEvent.click(screen.getByRole("button", { name: "Sí, registrar y solicitar" }));
  await screen.findByRole("textbox", { name: "Enlace de evaluación del socio formador" });
  assert.equal(screen.queryByRole("dialog"), null);
  await screen.findByText(/La revisión aún no ha finalizado/);
  assert.deepEqual(posts, ["/api/projects/project-1/sections/section-1/hito2"]);
  assert.equal(screen.queryByRole("button", { name: "Cerrar Hito 2 de mi sección" }), null);
  assert.equal(screen.queryByRole("textbox", { name: /Conclusiones/ }), null);
});

test("la confirmación de entrega bloquea dobles envíos y permite reintentar un fallo sin perder los videos", async (t) => {
  let state = hitoState();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (!options.method) return response(state);
    calls++;
    if (calls === 1) { await pending; return response("Error temporal al registrar los videos", 503); }
    state = { ...state, canPublish: false, canReceiveVideos: false,
      review: { id: "review-1", deliveredAt: now, expiresAt: "2027-01-18T15:00:00Z", completedAt: null,
        teams: [{ id: "team-1", name: "Equipo 1" }], evaluatedCount: 0, evaluations: [] } };
    return response({ id: "review-1", token: TOKEN });
  });
  render(React.createElement(HitoTwoPanel, panelProps()));
  fireEvent.click(await screen.findByRole("button", { name: "Registrar videos y solicitar retroalimentación" }));
  const dialog = screen.getByRole("dialog");
  const confirm = screen.getByRole("button", { name: "Sí, registrar y solicitar" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  assert.equal(calls, 1);
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(screen.getByRole("button", { name: "Volver a los videos" }).disabled, true);
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.getByRole("dialog"), dialog);
  release();
  await screen.findByRole("alert");
  assert.match(dialog.textContent, /Error temporal al registrar los videos/);
  assert.ok(screen.getByText("Video disponible"));
  assert.equal(screen.queryByRole("textbox", { name: "Enlace de evaluación del socio formador" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Sí, registrar y solicitar" }));
  await screen.findByRole("textbox", { name: "Enlace de evaluación del socio formador" });
  assert.equal(calls, 2);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("la confirmación de entrega se descarta al cambiar de sección y no permite publicar videos pendientes", async (t) => {
  const posts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options.method) { posts.push(url); return response({}); }
    return response(url.includes("section-2")
      ? { ...hitoState(), sectionId: "section-2", canPublish: false, videos: [{ id: "team-2", name: "Equipo 2", status: "pending" }] }
      : hitoState());
  });
  const props = panelProps();
  const view = render(React.createElement(HitoTwoPanel, props));
  fireEvent.click(await screen.findByRole("button", { name: "Registrar videos y solicitar retroalimentación" }));
  assert.ok(screen.getByRole("dialog"));
  view.rerender(React.createElement(HitoTwoPanel, { ...props, section: { id: "section-2", code: "002D" } }));
  await screen.findByText("Video pendiente");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(screen.getByRole("button", { name: "Registrar videos y solicitar retroalimentación" }).disabled, true);
  assert.deepEqual(posts, []);
});

test("el docente ve el resumen de su sección y sólo puede cerrar tras reconocerlo y confirmar", async (t) => {
  const state = { ...hitoState(), feedbackReady: true, canReceiveVideos: false,
    review: { id: "review-1", completedAt: now, deliveredAt: now, expiresAt: now, evaluatedCount: 1,
      teams: [{ id: "team-1", name: "Equipo 1" }], evaluations: [{ teamId: "team-1", strengths: "Fortaleza final", improvements: "Mejora final", rating: 4 }] } };
  t.mock.method(globalThis, "fetch", async () => response(state));
  t.mock.method(window, "confirm", () => { throw new Error("El cierre docente no debe usar la alerta del navegador"); });
  const submissions = [];
  render(React.createElement(HitoTwoPanel, { ...panelProps(), onSubmit: (_event, reviewId) => submissions.push(reviewId) }));
  await screen.findByText("Fortaleza final");
  assert.ok(screen.getByText("Mejora final"));
  assert.equal(screen.getByRole("textbox", { name: /Avance del resultado/ }).value, "Avance");
  assert.equal(screen.getByRole("textbox", { name: /Conclusiones/ }).value, "Conclusiones");
  assert.equal(screen.queryByText(/Entregable complementario/), null);
  assert.equal(document.querySelector('input[type="file"]'), null);
  const close = screen.getByRole("button", { name: "Cerrar Hito 2 de mi sección" });
  assert.equal(close.disabled, true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Revisé la retroalimentación final/ }));
  assert.equal(close.disabled, false);
  fireEvent.click(close);
  await screen.findByRole("dialog", { name: "¿Cerrar el Hito 2 de la sección 001D?" });
  assert.equal(submissions.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Volver al resumen" }));
  assert.equal(screen.queryByRole("dialog"), null);
  fireEvent.click(close);
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar Hito 2" }));
  await waitFor(() => assert.equal(Boolean(screen.queryByRole("dialog")), false));
  assert.deepEqual(submissions, ["review-1"]);
});

const completedHitoFeedback = () => ({ ...hitoState(), feedbackReady: true, canReceiveVideos: false,
  review: { id: "review-1", completedAt: now, deliveredAt: now, expiresAt: now, evaluatedCount: 1,
    teams: [{ id: "team-1", name: "Equipo 1" }], evaluations: [{ teamId: "team-1", strengths: "Fortaleza final", improvements: "Mejora final", rating: 4 }] } });

const partialHitoFeedback = (evaluatedCount = 2) => ({ ...hitoState(), canPublish: false, canReceiveVideos: false,
  canManageReviewClosure: true, canCloseReview: evaluatedCount > 0,
  review: { id: "review-1", deliveredAt: now, expiresAt: "2000-01-01T00:00:00Z", completedAt: null,
    teams: [1, 2, 3].map((n) => ({ id: `team-${n}`, name: `Equipo ${n}` })), evaluatedCount, evaluations: [] } });
const partialEvaluations = () => [
  { teamId: "team-1", strengths: "Fortaleza uno", improvements: "Mejora uno", rating: 4, reviewedAt: now },
  { teamId: "team-2", strengths: "Fortaleza dos", improvements: "Mejora dos", rating: 2, reviewedAt: now },
];

test("el cierre parcial docente muestra conteos y un promedio sólo de evaluados y no cierra Hito 2", async (t) => {
  let state = partialHitoFeedback();
  const posts = [], milestones = [];
  t.mock.method(window, "confirm", () => { throw new Error("El cierre parcial no usa alertas del navegador"); });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!options.method) return response(state);
    posts.push({ url, body: JSON.parse(options.body) });
    state = { ...state, feedbackReady: true, canManageReviewClosure: false, canCloseReview: false,
      review: { ...state.review, completedAt: now, closedInternally: true, closedByName: "Docente de prueba", evaluations: partialEvaluations() } };
    return response({ id: "review-1", completedAt: now, closedInternally: true });
  });
  render(React.createElement(HitoTwoPanel, { ...panelProps(), onSubmit: (...args) => milestones.push(args) }));
  const trigger = await screen.findByRole("button", { name: "Cerrar revisión del socio" });
  assert.equal(screen.queryByText("Fortaleza uno"), null, "draft feedback remains hidden before closure");
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "¿Cerrar la revisión de la sección 001D?" });
  assert.match(dialog.textContent, /2 de 3 equipos evaluados/);
  assert.match(dialog.textContent, /no cierra el Hito 2/);
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Seguir esperando" }));
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, trigger); assert.equal(posts.length, 0);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar revisión" }));
  await screen.findByText("Fortaleza uno");
  assert.ok(screen.getByText("Fortaleza dos"));
  assert.ok(screen.getByText("Sin evaluar"));
  assert.ok(screen.getByText("3.0/5"));
  assert.equal(screen.queryByText("0/5"), null);
  assert.deepEqual(posts, [{ url: "/api/projects/project-1/sections/section-1/hito2/close-review", body: { reviewId: "review-1" } }]);
  assert.deepEqual(milestones, []);
  assert.equal(screen.getByRole("button", { name: "Cerrar Hito 2 de mi sección" }).disabled, true);
});

test("cero evaluaciones deshabilita el cierre parcial y sin permiso no aparece el control", async (t) => {
  const posts = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (options.method) posts.push(options.method);
    return response(partialHitoFeedback(0));
  });
  const view = render(React.createElement(HitoTwoPanel, panelProps()));
  const trigger = await screen.findByRole("button", { name: "Cerrar revisión del socio" });
  assert.equal(trigger.disabled, true);
  assert.ok(screen.getByText(/Se necesita al menos una evaluación guardada/));
  fireEvent.click(trigger);
  assert.equal(screen.queryByRole("dialog"), null); assert.deepEqual(posts, []);
  view.unmount();
  t.mock.method(globalThis, "fetch", async () => response({ ...partialHitoFeedback(), canManageReviewClosure: false, canCloseReview: false }));
  render(React.createElement(HitoTwoPanel, panelProps()));
  await screen.findByText(/La revisión aún no ha finalizado/);
  assert.equal(screen.queryByRole("button", { name: "Cerrar revisión del socio" }), null);
});

test("el cierre parcial bloquea doble envío y Escape durante el guardado y permite reintentar errores", async (t) => {
  let state = partialHitoFeedback();
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (!options.method) return response(state);
    calls++;
    if (calls === 1) { await gate; return response("Error temporal de cierre parcial", 503); }
    state = { ...state, feedbackReady: true, canManageReviewClosure: false,
      review: { ...state.review, completedAt: now, closedInternally: true, evaluations: partialEvaluations() } };
    return response({ id: "review-1", completedAt: now, closedInternally: true });
  });
  render(React.createElement(HitoTwoPanel, panelProps()));
  fireEvent.click(await screen.findByRole("button", { name: "Cerrar revisión del socio" }));
  const confirm = screen.getByRole("button", { name: "Sí, cerrar revisión" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  const dialog = screen.getByRole("dialog");
  assert.equal(dialog.getAttribute("aria-busy"), "true");
  assert.equal(screen.getByRole("button", { name: "Seguir esperando" }).disabled, true);
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  assert.ok(screen.getByRole("dialog")); assert.equal(calls, 1);
  release();
  await screen.findByText("Error temporal de cierre parcial");
  assert.ok(screen.getByRole("dialog"));
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar revisión" }));
  await screen.findByText("Fortaleza uno");
  assert.equal(calls, 2); assert.equal(screen.queryByRole("dialog"), null);
});

test("coordinación cierra una revisión vencida de la sección seleccionada y conserva las respuestas", async (t) => {
  const review = { ...reviewData(), sectionId: "section-1", createdAt: now, expiresAt: "2000-01-01T00:00:00Z",
    active: false, canManageClosure: true, canClose: true, evaluations: partialEvaluations().slice(0, 1) };
  let reviews = [review, { ...review, id: "review-2", sectionId: "section-2" }];
  const posts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (!options.method) return response(reviews);
    posts.push({ url, body: JSON.parse(options.body) });
    reviews = reviews.map((item) => item.id === "review-2"
      ? { ...item, completedAt: now, closedInternally: true, canManageClosure: false, canClose: false } : item);
    return response({ id: "review-2", completedAt: now, closedInternally: true, closedByName: "Coordinador CITT" });
  });
  render(React.createElement(ReviewManager, { projectId: "project-1",
    sections: [{ id: "section-1", code: "001D", campusName: "Maipú" }, { id: "section-2", code: "002D", campusName: "Maipú" }] }));
  await screen.findByText(/El enlace dura como máximo 21 días/);
  await waitFor(() => assert.equal(document.querySelectorAll("details").length, 1));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "section-2" } });
  document.querySelector("details").open = true;
  fireEvent.click(screen.getByRole("button", { name: "Cerrar revisión del socio" }));
  assert.ok(screen.getByRole("dialog", { name: "¿Cerrar la revisión de la sección 002D?" }));
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar revisión" }));
  await screen.findByText(/Revisión cerrada con las respuestas guardadas/);
  assert.deepEqual(posts, [{ url: "/api/projects/project-1/sections/section-2/hito2/close-review", body: { reviewId: "review-2" } }]);
  assert.ok(screen.getByText("Sin evaluar · No se incluye en el promedio"));
  assert.equal(screen.queryByRole("button", { name: "Cerrar revisión del socio" }), null);
});

test("el socio que vuelve a un cierre interno ve las respuestas de sólo lectura y los equipos sin evaluar", async (t) => {
  const api = mockReviewApi(t, { ...reviewData(), completedAt: now, closedInternally: true,
    evaluations: [{ teamId: "team-1", strengths: "Fortaleza guardada", improvements: "Mejora guardada", rating: 4, reviewedAt: now }] });
  session();
  await screen.findByRole("heading", { name: "Tu revisión quedó registrada" });
  assert.ok(screen.getByText("Sin evaluar"));
  assert.equal(screen.getByRole("button", { name: "Sin evaluación" }).disabled, true);
  assert.equal(screen.queryByRole("button", { name: "Finalizar revisión" }), null);
  fireEvent.click(screen.getByRole("button", { name: "Ver evaluación" }));
  assert.equal(screen.getByRole("textbox", { name: /Fortalezas/ }).disabled, true);
  assert.equal(screen.getByRole("textbox", { name: /Fortalezas/ }).value, "Fortaleza guardada");
  assert.equal(api.calls.some(({ options }) => options.method), false);
});

test("Escape vuelve al resumen docente sin guardar y no se ofrece cerrar sin avance o conclusiones", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response(completedHitoFeedback()));
  const submissions = [];
  const props = { ...panelProps(), onSubmit: (_event, reviewId) => submissions.push(reviewId) };
  const view = render(React.createElement(HitoTwoPanel, props));
  await screen.findByText("Fortaleza final");
  const trigger = screen.getByRole("button", { name: "Cerrar Hito 2 de mi sección" });
  fireEvent.submit(trigger.form);
  assert.equal(screen.queryByRole("dialog"), null); // acknowledgement is mandatory
  fireEvent.click(screen.getByRole("checkbox", { name: /Revisé la retroalimentación final/ }));
  trigger.focus();
  fireEvent.click(trigger);
  assert.equal(document.activeElement, screen.getByRole("button", { name: "Volver al resumen" }));
  fireEvent(screen.getByRole("dialog"), new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(submissions, []);
  for (const key of ["advance", "conclusions"]) {
    view.rerender(React.createElement(HitoTwoPanel, { ...props, progress: { ...props.progress, [key]: " " } }));
    fireEvent.submit(trigger.form);
    assert.equal(screen.queryByRole("dialog"), null);
  }
});

test("el cierre docente evita dobles envíos y conserva el resumen y los textos cuando falla el guardado", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response(completedHitoFeedback()));
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  render(React.createElement(HitoTwoPanel, { ...panelProps(), onSubmit: async (_event, reviewId) => {
    assert.equal(reviewId, "review-1");
    calls++;
    await pending;
    if (calls === 1) throw new Error("Error temporal al cerrar la sección");
    return true;
  } }));
  await screen.findByText("Fortaleza final");
  fireEvent.click(screen.getByRole("checkbox", { name: /Revisé la retroalimentación final/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar Hito 2 de mi sección" }));
  const confirm = screen.getByRole("button", { name: "Sí, cerrar Hito 2" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  assert.equal(calls, 1);
  assert.equal(screen.getByRole("button", { name: "Volver al resumen" }).disabled, true);
  const dialog = screen.getByRole("dialog");
  fireEvent(dialog, new window.Event("cancel", { cancelable: true }));
  assert.equal(screen.getByRole("dialog"), dialog);
  release();
  await screen.findByRole("alert");
  assert.match(dialog.textContent, /Error temporal al cerrar la sección/);
  assert.equal(screen.getByRole("textbox", { name: /Avance del resultado/ }).value, "Avance");
  assert.equal(screen.getByRole("textbox", { name: /Conclusiones/ }).value, "Conclusiones");
  assert.ok(screen.getByText("Fortaleza final"));
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar Hito 2" }));
  await waitFor(() => assert.equal(Boolean(screen.queryByRole("dialog")), false));
  assert.equal(calls, 2);
});

test("un cierre docente rechazado sin excepción tampoco oculta la confirmación como si hubiera terminado", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response(completedHitoFeedback()));
  render(React.createElement(HitoTwoPanel, { ...panelProps(), onSubmit: async () => false }));
  await screen.findByText("Fortaleza final");
  fireEvent.click(screen.getByRole("checkbox", { name: /Revisé la retroalimentación final/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar Hito 2 de mi sección" }));
  fireEvent.click(screen.getByRole("button", { name: "Sí, cerrar Hito 2" }));
  await screen.findByRole("alert");
  assert.ok(screen.getByRole("dialog"));
  assert.match(screen.getByRole("alert").textContent, /No se pudo cerrar el Hito 2/);
});

test("un error al comprobar estado no permite publicar ni cerrar usando el estado anterior", async (t) => {
  let fail = false;
  t.mock.method(globalThis, "fetch", async () => fail ? response("Error al actualizar", 503) : response(hitoState()));
  render(React.createElement(HitoTwoPanel, panelProps()));
  await screen.findByRole("button", { name: "Registrar videos y solicitar retroalimentación" });
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Actualizar estado" }));
  await screen.findByText("Error al actualizar");
  assert.equal(screen.getByRole("button", { name: "Registrar videos y solicitar retroalimentación" }).disabled, true);
});

test("el alumno carga a Azure sin cookies y confirma el intento sin enviar destinos a la API", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/video-delivery") return response({ projectName: "Proyecto", teamName: "Equipo 1", campusName: "Concepción", sectionCode: "001D", open: true, maxBytes: 200 * 1024 * 1024 });
    if (url === "/api/video-delivery/upload") return response({ attemptId: "attempt-1", url: "https://video.example.test/one.mp4?sig=test" });
    if (url.startsWith("https://video.example.test")) return new Response(null, { status: 201 });
    if (url === "/api/video-delivery/confirm") return response({ filename: "video.mp4", deliveredAt: now });
    throw new Error(`Unexpected URL: ${url}`);
  });
  render(React.createElement(MemoryRouter, { initialEntries: [`/entrega-video#${TOKEN}`] }, React.createElement(StudentVideoDeliveryPage)));
  const input = await screen.findByLabelText(/Video del equipo/);
  const file = new window.File(["testvideo"], "video.mp4", { type: "video/mp4" });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.submit(input.form);
  await screen.findByText(/Video entregado y confirmado/);
  const upload = calls.find(({ url }) => url.startsWith("https://"));
  assert.equal(upload.options.method, "PUT"); assert.equal(upload.options.credentials, "omit");
  assert.equal(upload.options.headers["If-None-Match"], "*");
  assert.equal(upload.options.headers.Authorization, undefined);
  assert.equal(upload.options.headers["X-VCM-Link-Token"], undefined);
  const begin = calls.find(({ url }) => url.endsWith("/upload"));
  assert.deepEqual(JSON.parse(begin.options.body), { name: "video.mp4", size: file.size });
  const confirm = calls.find(({ url }) => url.endsWith("/confirm"));
  assert.deepEqual(JSON.parse(confirm.options.body), { attemptId: "attempt-1" });
  for (const call of calls.filter(({ url }) => url.startsWith("/api/"))) {
    assert.equal(call.options.headers["X-VCM-Link-Token"], TOKEN);
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.url.includes(TOKEN), false);
  }
});

test("el alumno puede reintentar una confirmación fallida sin duplicar la carga", async (t) => {
  let confirmations = 0;
  let uploads = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "/api/video-delivery") return response({ projectName: "Proyecto", teamName: "Equipo 1", campusName: "Concepción", sectionCode: "001D", open: true, maxBytes: 200 * 1024 * 1024 });
    if (url.endsWith("/upload")) return response({ attemptId: "attempt-1", url: "https://video.example.test/one.mp4?sig=test" });
    if (url.startsWith("https://")) { uploads++; return new Response(null, { status: 201 }); }
    if (url.endsWith("/confirm")) return ++confirmations === 1 ? response("Confirmación temporalmente no disponible", 503) : response({ filename: "video.mp4", deliveredAt: now });
  });
  render(React.createElement(MemoryRouter, { initialEntries: [`/entrega-video#${TOKEN}`] }, React.createElement(StudentVideoDeliveryPage)));
  const input = await screen.findByLabelText(/Video del equipo/);
  fireEvent.change(input, { target: { files: [new window.File(["test"], "video.mp4", { type: "video/mp4" })] } });
  fireEvent.submit(input.form);
  await screen.findByText("Confirmación temporalmente no disponible");
  fireEvent.click(screen.getByRole("button", { name: "Reintentar confirmación sin volver a subir" }));
  await screen.findByText(/Video entregado y confirmado/);
  assert.equal(uploads, 1); assert.equal(confirmations, 2);
});
