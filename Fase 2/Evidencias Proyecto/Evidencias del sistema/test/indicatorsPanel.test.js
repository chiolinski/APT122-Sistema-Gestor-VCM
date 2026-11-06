import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://indicators.example.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { render, screen, cleanup } = await import("@testing-library/react");
const require = createRequire(import.meta.url);

async function component(relativePath) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const { outputFiles } = await build({ entryPoints: [filename], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.require = require;
  compiled._compile(outputFiles[0].text, filename);
  return compiled.exports.default;
}

const IndicatorsPanel = await component("../src/components/IndicatorsPanel.jsx");
const { buildIndicators } = require("../api/src/lib/indicators.js");

const pilotProject = {
  code: "VCM-2026-001", name: "Proyecto ficticio", school: "Escuela ficticia",
  participations: 12, assigned: 8, dropped: 2, sections: 2,
  milestoneOne: 2, milestoneTwo: 0, closedSections: 0,
  teams: 6, videos: 5, reviewsSent: 1, reviewsAnswered: 1, evaluations: 4, ratingSum: 16,
};

afterEach(() => cleanup());

test("el panel muestra el avance por proyecto, los estudiantes, el socio y el detalle", () => {
  const indicators = buildIndicators({
    period: "2026-2", projects: [pilotProject],
    schools: [{ school: "Escuela ficticia", projects: 1 }, { school: "Otra escuela", projects: 1 }],
  });
  render(React.createElement(IndicatorsPanel, { indicators }));
  assert.ok(screen.getByText("1 de 2 proyectos del período en ejecución o finalizados"));
  assert.ok(screen.getByText("Paso 3 · Finalizado"));
  assert.ok(screen.getByText("2 de 2 secciones listas"));
  assert.ok(screen.getByText("0 de 2 secciones cerradas"));
  assert.ok(screen.getByText("8 de 10 · 80 %"));
  assert.ok(screen.getByText("0 de 1 proyecto con todos en equipo"));
  assert.ok(screen.getByText("2 de 12 · 17 %"));
  assert.ok(screen.getByText("1 de 1 revisiones respondidas"));
  assert.ok(screen.getByText("4 evaluaciones de equipos · 1 proyecto"));
  assert.ok(screen.getByText("VCM-2026-001"));
  assert.equal(screen.queryByText(/Hito 3/), null);
});

test("sin proyectos en ejecución el panel indica que aún no hay datos", () => {
  render(React.createElement(IndicatorsPanel, { indicators: buildIndicators({ period: "2026-2" }) }));
  assert.ok(screen.getAllByText("Sin datos aún").length >= 3);
  assert.ok(screen.getByText("Muestra insuficiente"));
  assert.ok(screen.getByText("No hay proyectos en ejecución en este período."));
  assert.ok(screen.getByText("No hay proyectos en este período."));
});
