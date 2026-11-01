import { decodeCsvFile } from "../utils/csvEncoding.js";

const REQUIRED_HEADERS = ["rut", "razon_social", "nombre_contacto", "correo_contacto"];

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export async function parsePartnerCsv(file) {
  const text = await decodeCsvFile(file);
  const matrix = parseDelimited(text.replace(/^\uFEFF/, ""), detectDelimiter(text));
  if (matrix.length < 2) throw new Error("El archivo debe contener encabezados y al menos un socio formador.");
  const headers = matrix[0].map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);
  return matrix.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, String(cells[index] || "").trim()]),
  ));
}

async function partnerImportRequest(path, options = {}) {
  const response = await fetch(`/api/partners/imports${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible procesar la carga de socios formadores.");
  return payload.data;
}

export function previewPartnerImport(rows) {
  return partnerImportRequest("/preview", { method: "POST", body: JSON.stringify({ rows }) });
}

export function applyPartnerImport(filename, rows) {
  return partnerImportRequest("/apply", { method: "POST", body: JSON.stringify({ filename, rows }) });
}

export function listPartnerImports() {
  return partnerImportRequest("");
}
