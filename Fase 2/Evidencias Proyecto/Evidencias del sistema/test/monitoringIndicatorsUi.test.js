import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { MemoryRouter } = await import("react-router-dom");
const { render, screen, fireEvent, waitFor, cleanup, within, act } = await import("@testing-library/react");
const require = createRequire(import.meta.url);
const { buildCoordinationMonitoring } = require("../api/src/lib/coordinationMonitoring");

async function component(relativePath) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const { outputFiles } = await build({ entryPoints: [filename], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const compiled = new Module(filename);
  compiled.require = require;
  compiled._compile(outputFiles[0].text, filename);
  return compiled.exports.default;
}
const Indicators = await component("../src/components/MonitoringIndicators.jsx");
const CampusCharts = await component("../src/components/MonitoringCampusCharts.jsx");
const Page = await component("../src/pages/CoordinationMonitoringPage.jsx");
afterEach(cleanup);

function report(filters = {}) {
  return buildCoordinationMonitoring({
    projectRows: [
      { databaseId: "p1", id: "P1", name: "Proyecto ficticio cerrado", status: "FINALIZADO", partnerId: "partner1", subjectCode: "D1", subjectName: "Asignatura ficticia", availableFrom: "2026-10-01" },
      { databaseId: "p2", id: "P2", name: "Proyecto ficticio pendiente", status: "PLANIFICADO", partnerId: "partner2", subjectCode: "D2", subjectName: "Otra asignatura ficticia" },
    ],
    sectionRows: [
      { projectId: "p1", id: "s1", code: "001D", campusName: "Sede ficticia", periodCode: "2026-2", hito1Status: "COMPLETADO", hito2Status: "COMPLETADO", hito3Status: "COMPLETADO" },
      { projectId: "p2", id: "s2", code: "002D", campusName: "Otra sede ficticia", periodCode: "2026-1", hito1Status: "PENDIENTE", hito2Status: "PENDIENTE", hito3Status: "PENDIENTE" },
    ],
    studentRows: [{ projectId: "p1", sectionId: "s1", studentId: "student1", teamId: "team1", assignmentStatus: "ASIGNADO", videoDelivered: true }],
    reviewRows: [{ projectId: "p1", sectionId: "s1", reviewId: "review1", partnerId: "partner1", teamId: "team1", rating: 4 }],
  }, "2026-11-05", filters);
}

const response = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
function requestFilters(url) {
  const query = new URL(url, "http://127.0.0.1").searchParams;
  return { scope: query.get("scope") || "all", campus: query.get("campus") || "all", search: query.get("search") || "", period: query.get("period") || "" };
}
const renderPage = () => render(React.createElement(MemoryRouter, null, React.createElement(Page)));

test("los indicadores muestran avances globales accesibles y una valoración basada en evaluaciones", () => {
  const data = report();
  render(React.createElement(Indicators, { indicators: data.indicators, summary: data.summary, generatedAt: data.generatedAt }));
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos con Hito 1 terminado" }).getAttribute("aria-valuenow"), "50");
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos con Hito 2 terminado" }).getAttribute("aria-valuetext"), "1 de 2 proyectos, 50%");
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos finalizados" }).getAttribute("aria-valuenow"), "50");
  assert.ok(screen.getByText("Estudiantes participantes"));
  assert.ok(screen.getByText("1 proyecto valorado · 1 evaluación de equipo"));
  assert.ok(screen.getByText(/Cada proyecto tiene el mismo peso/));
});

test("sin respuestas no presenta un promedio cero ni divisiones inválidas", () => {
  const data = buildCoordinationMonitoring({});
  render(React.createElement(Indicators, { indicators: data.indicators, summary: data.summary }));
  assert.ok(screen.getByText("Sin evaluaciones todavía. La ausencia de respuestas no se cuenta como cero."));
  assert.ok(screen.getByText("Aún no hay revisiones publicadas"));
  assert.ok(screen.getByText("—"));
  assert.doesNotMatch(document.body.textContent, /NaN|Infinity|undefined/);
});

test("el período filtra el panel, el desglose y la comparación por sede", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => response(report(requestFilters(url))));
  renderPage();
  const select = await screen.findByRole("combobox", { name: "Filtrar por período académico" });
  fireEvent.change(select, { target: { value: "2026-2" } });
  await screen.findByText(/Vista filtrada · 1 proyecto/);
  assert.equal(select.options.length, 3);
  assert.ok(screen.getByText("Equipos con video entregado"));
  fireEvent.click(screen.getByText("Ver indicadores por proyecto"));
  const table = screen.getByRole("table", { name: /Proyectos en ejecución o finalizados/ });
  assert.equal(within(table).getAllByRole("row").length, 2);
  assert.ok(within(table).getByText("1 evaluación"));
  assert.ok(screen.getByText("Proyectos por escuela"));
  const charts = screen.getByRole("region", { name: "Comparación por sede" });
  assert.equal(within(charts).getAllByRole("progressbar").length, 2);
});

test("el estado actualiza indicadores, alertas y proyectos con la misma selección", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => { requests.push(url); return response(report(requestFilters(url))); });
  renderPage();
  await screen.findByRole("heading", { name: "Participación y avance" });
  fireEvent.click(screen.getByRole("tab", { name: "Finalizados" }));
  assert.equal(screen.queryByRole("region", { name: "Participación y avance" }), null, "No presenta cifras anteriores para una selección nueva.");
  await screen.findByText(/Vista filtrada · 1 proyecto/);
  assert.ok(screen.getByText("Proyecto ficticio cerrado"));
  assert.equal(screen.queryByText("Proyecto ficticio pendiente"), null);
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos finalizados" }).getAttribute("aria-valuenow"), "100");
  assert.equal(requestFilters(requests.at(-1)).scope, "finished");
  const charts = screen.getByRole("region", { name: "Comparación por sede" });
  assert.equal(within(charts).getAllByRole("progressbar").length, 2);
  assert.equal(within(charts).getByRole("progressbar", { name: "Avance de hitos por sección en Sede ficticia" }).getAttribute("aria-valuenow"), "100");
  assert.equal(within(charts).queryByText("Otra sede ficticia"), null);
  const alerts = screen.getByRole("region", { name: "Alertas de seguimiento" });
  assert.equal(within(alerts).getAllByRole("link", { name: /Revisar/ }).length, 1);
});

test("combina sede, estado y búsqueda, conserva las opciones y devuelve ceros sólo cuando la selección está vacía", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => response(report(requestFilters(url))));
  renderPage();
  await screen.findByRole("heading", { name: "Participación y avance" });
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por sede" }), { target: { value: "Otra sede ficticia" } });
  await screen.findByText(/Vista filtrada · 1 proyecto/);
  assert.equal(screen.queryByText("Proyecto ficticio cerrado"), null);
  assert.ok(screen.getByText("Proyecto ficticio pendiente"));
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos finalizados" }).getAttribute("aria-valuenow"), "0");
  assert.ok(screen.getByText("Sin evaluaciones todavía. La ausencia de respuestas no se cuenta como cero."));
  fireEvent.click(screen.getByRole("tab", { name: "Finalizados" }));
  await screen.findByText(/Vista filtrada · 0 proyectos/);
  assert.ok(screen.getByText("No hay proyectos para estos filtros"));
  assert.ok(within(screen.getByRole("region", { name: "Comparación por sede" })).getByText(/No hay sedes con proyectos para estos filtros/));
  assert.equal(screen.getByRole("combobox", { name: "Filtrar por sede" }).options.length, 3, "Las opciones no desaparecen al filtrar.");
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por sede" }), { target: { value: "all" } });
  await screen.findByText(/Vista filtrada · 1 proyecto/);
  fireEvent.change(screen.getByPlaceholderText("Proyecto, sección o docente"), { target: { value: "no existe" } });
  await screen.findByText(/Vista filtrada · 0 proyectos/);
  fireEvent.change(screen.getByPlaceholderText("Proyecto, sección o docente"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("tab", { name: "Todos" }));
  await screen.findByText(/Portafolio completo · 2 proyectos/);
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos finalizados" }).getAttribute("aria-valuenow"), "50");
});

test("una respuesta lenta de un filtro anterior no reemplaza la selección actual", async (t) => {
  const waiting = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    const filters = requestFilters(url);
    if (filters.campus === "all") return Promise.resolve(response(report(filters)));
    return new Promise((resolve) => waiting.push({ filters, signal: options.signal, resolve }));
  });
  renderPage();
  await screen.findByRole("heading", { name: "Participación y avance" });
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por sede" }), { target: { value: "Otra sede ficticia" } });
  await waitFor(() => assert.equal(waiting.length, 1));
  fireEvent.click(screen.getByRole("tab", { name: "Finalizados" }));
  await waitFor(() => assert.equal(waiting.length, 2));
  assert.equal(waiting[0].signal.aborted, true);
  await act(async () => waiting[1].resolve(response(report(waiting[1].filters))));
  await screen.findByText(/Vista filtrada · 0 proyectos/);
  await act(async () => waiting[0].resolve(response(report(waiting[0].filters))));
  assert.ok(screen.getByText(/Vista filtrada · 0 proyectos/));
  assert.equal(screen.queryByText("Proyecto ficticio pendiente"), null);
});

test("ocultar y mostrar alertas conserva el contador y la preferencia al filtrar sin modificar datos", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return response(report(requestFilters(url))); });
  renderPage();
  await screen.findByRole("heading", { name: "Participación y avance" });
  const alerts = screen.getByRole("region", { name: "Alertas de seguimiento" });
  assert.equal(within(alerts).getAllByRole("link", { name: /Revisar/ }).length, 2);
  fireEvent.click(screen.getByRole("button", { name: "Ocultar alertas" }));
  assert.equal(screen.getByRole("button", { name: "Mostrar alertas" }).getAttribute("aria-expanded"), "false");
  assert.equal(within(alerts).queryByRole("link", { name: /Revisar/ }), null);
  assert.ok(within(alerts).getByLabelText("2 alertas"));
  assert.equal(calls.length, 1, "Ocultar alertas no envía solicitudes.");
  fireEvent.click(screen.getByRole("tab", { name: "Finalizados" }));
  await screen.findByText(/Vista filtrada · 1 proyecto/);
  assert.equal(screen.getByRole("button", { name: "Mostrar alertas" }).getAttribute("aria-expanded"), "false");
  fireEvent.click(screen.getByRole("button", { name: "Mostrar alertas" }));
  const filteredAlerts = screen.getByRole("region", { name: "Alertas de seguimiento" });
  assert.equal(within(filteredAlerts).getAllByRole("link", { name: /Revisar/ }).length, 1);
  assert.equal(screen.getByRole("button", { name: "Ocultar alertas" }).getAttribute("aria-expanded"), "true");
  assert.ok(calls.every(({ options }) => !options.method || options.method === "GET"));
});

test("un fallo al actualizar identifica las cifras anteriores sin sustituirlas por ceros", async (t) => {
  const data = report();
  let fail = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (fail) throw new Error("API local desconectada");
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  render(React.createElement(MemoryRouter, null, React.createElement(Page)));
  await screen.findByRole("heading", { name: "Participación y avance" });
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /API local desconectada/));
  const overview = screen.getByRole("region", { name: "Participación y avance" });
  assert.match(within(overview).getByRole("status").textContent, /Últimos datos recibidos/);
  assert.ok(within(overview).getByText(/Portafolio completo · 2 proyectos/));
});

test("si falla una selección nueva no muestra los indicadores anteriores como si fueran filtrados y permite reintentar", async (t) => {
  let fail = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (fail) throw new Error("API local desconectada");
    return response(report(requestFilters(url)));
  });
  renderPage();
  await screen.findByRole("heading", { name: "Participación y avance" });
  fail = true;
  fireEvent.click(screen.getByRole("tab", { name: "Finalizados" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /API local desconectada/));
  assert.equal(screen.queryByRole("region", { name: "Participación y avance" }), null);
  assert.equal(screen.queryByRole("region", { name: "Comparación por sede" }), null);
  assert.equal(screen.queryByText("No hay proyectos para estos filtros"), null);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  await screen.findByText(/Vista filtrada · 1 proyecto/);
  assert.equal(screen.getByRole("progressbar", { name: "Proyectos finalizados" }).getAttribute("aria-valuenow"), "100");
});

test("gráficos por sede muestran escala común, cifras accesibles y detalle sin inventar participación sin matrícula", () => {
  const data = report();
  render(React.createElement(CampusCharts, { campuses: data.campusComparisons }));
  assert.equal(screen.getByRole("progressbar", { name: "Participación estudiantil en Sede ficticia" }).getAttribute("aria-valuetext"), "1 de 1 estudiantes, 100%");
  assert.equal(screen.getByRole("progressbar", { name: "Avance de hitos por sección en Otra sede ficticia" }).getAttribute("aria-valuenow"), "0");
  assert.equal(screen.queryByRole("progressbar", { name: "Participación estudiantil en Otra sede ficticia" }), null);
  assert.ok(screen.getByText("Sin matrícula para calcular participación"));
  fireEvent.click(screen.getByText("Ver cifras por sede"));
  assert.equal(screen.getByRole("table").querySelectorAll("tbody tr").length, 2);
  assert.ok(screen.getByText("Sin matrícula"));
  assert.doesNotMatch(document.body.textContent, /NaN|Infinity|undefined/);
});

test("los gráficos identifican datos anteriores al fallar una actualización", async (t) => {
  let fail = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (fail) throw new Error("API local desconectada");
    return response(report());
  });
  renderPage();
  await screen.findByRole("region", { name: "Comparación por sede" });
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  await waitFor(() => assert.ok(within(screen.getByRole("region", { name: "Comparación por sede" })).getByText(/Últimos datos recibidos/)));
});
