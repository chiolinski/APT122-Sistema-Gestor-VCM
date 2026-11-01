import { decodeCsvFile } from "../utils/csvEncoding.js";

const REQUIRED_HEADERS = [
  "periodo", "sede_codigo", "sede_nombre", "asignatura_codigo", "asignatura_nombre",
  "escuela_nombre",
  "seccion_codigo", "docente_id", "docente_nombre",
  "estudiante_rut", "estudiante_nombre",
];

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

export async function parseAcademicCsv(file) {
  const text = await decodeCsvFile(file);
  const matrix = parseDelimited(text.replace(/^\uFEFF/, ""), detectDelimiter(text));
  if (matrix.length < 2) throw new Error("El archivo debe contener encabezados y al menos una fila de datos.");
  const headers = matrix[0].map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(", ")}.`);
  return matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] || "").trim()])));
}

export function previewAcademicRows(rows) {
  const issues = [];
  const campuses = new Set();
  const schools = new Set();
  const subjects = new Set();
  const sections = new Set();
  const teachers = new Set();
  const students = new Set();
  const studentSubjects = new Map();
  const subjectSchools = new Map();
  const periods = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const missing = REQUIRED_HEADERS.filter((field) => !row[field]);
    if (missing.length) {
      issues.push({ level: "error", row: rowNumber, message: `Faltan datos: ${missing.join(", ")}.` });
      return;
    }
    const rut = row.estudiante_rut.replace(/[.-]/g, "").toUpperCase();
    const subject = row.asignatura_codigo.toUpperCase();
    const school = row.escuela_nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const section = `${row.periodo}|${row.sede_codigo}|${subject}|${row.seccion_codigo}`.toUpperCase();
    const key = `${rut}|${subject}`;
    if (studentSubjects.has(key) && studentSubjects.get(key) !== section) {
      issues.push({ level: "error", row: rowNumber, message: `${row.estudiante_nombre} aparece en dos secciones de ${subject}.` });
    }
    studentSubjects.set(key, section);
    if (subjectSchools.has(subject) && subjectSchools.get(subject) !== school) {
      issues.push({ level: "error", row: rowNumber, message: `${subject} aparece vinculada a más de una escuela.` });
    }
    subjectSchools.set(subject, school);
    periods.add(row.periodo.toUpperCase());
    campuses.add(row.sede_codigo.toUpperCase());
    schools.add(school);
    subjects.add(subject);
    sections.add(section);
    teachers.add(row.docente_id.toUpperCase());
    students.add(rut);
  });
  if (periods.size > 1) issues.push({ level: "error", row: 0, message: "El archivo contiene más de un período académico." });
  return {
    canApply: !issues.some((issue) => issue.level === "error"),
    issues,
    summary: { rows: rows.length, campuses: campuses.size, schools: schools.size, subjects: subjects.size, sections: sections.size, teachers: teachers.size, students: students.size },
  };
}

export async function getAcademicCatalogs() {
  const response = await fetch("/api/academic-catalogs", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("API académica local no disponible");
  return (await response.json()).data;
}

export async function applyAcademicImport(filename, rows) {
  const response = await fetch("/api/academic-imports/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ filename, rows }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible aplicar la carga académica.");
  return payload.data;
}

async function academicRequest(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible consultar los datos académicos.");
  return payload.data;
}

export function getAcademicRecords(entity, query = "", page = 1, pageSize = 25) {
  const params = new URLSearchParams({ query, page: String(page), pageSize: String(pageSize) });
  return academicRequest(`academic-records/${encodeURIComponent(entity)}?${params}`);
}

export function updateAcademicRecord(entity, recordId, changes) {
  return academicRequest(`academic-records/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}
