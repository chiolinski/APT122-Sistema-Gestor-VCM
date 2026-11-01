export const VIDEO_ACCOUNT_URL = "http://127.0.0.1:10000/devstoreaccount1";
export const VIDEO_CONTAINER = "vcm-local-videos";
export const DEMO_VIDEO_CONTEXT = {
  campusName: "Concepción", subjectName: "Desarrollo de aplicaciones móviles", sectionCode: "001D",
};

function slug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getVideoTeamNumber(team) {
  const match = String(team?.name || "").trim().match(/^(?:equipo|grupo)\s*0*(\d{1,2})$/i);
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= 20 ? number : null;
}

export function getSectionVideoFolder(context) {
  const campus = slug(String(context?.campusName || "").trim().replace(/^sede\s+/i, ""));
  // Las carpetas existentes omiten "de": Desarrollo de aplicaciones móviles -> desarrollo-aplicaciones-moviles.
  const subject = slug(String(context?.subjectName || "").replace(/\bde\b/gi, " "));
  const section = String(context?.sectionCode || "").trim().toUpperCase();
  if (!campus || !subject || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(section)) return null;
  return `${campus}/${subject}/${section}`;
}

export function getVideoCandidates(context, team) {
  const folder = getSectionVideoFolder(context);
  if (folder && team?.videoBlobName) {
    const prefix = `${folder}/Entrega-${String(team.id).toLowerCase()}-`;
    const suffix = team.videoBlobName.slice(prefix.length);
    if (!team.videoBlobName.startsWith(prefix) || !/^[a-f0-9-]{36}\.mp4$/.test(suffix)) throw new Error("Invalid delivered video path");
    return [team.videoBlobName];
  }
  const number = getVideoTeamNumber(team);
  if (!folder || number === null) return [];
  const candidates = [`${folder}/Videoequipo${number}.mp4`];
  // Archivos expresamente indicados para la sección de prueba; no se descubren
  // ni se reutilizan prefijos personales en otras secciones o equipos.
  if (folder === "concepcion/desarrollo-aplicaciones-moviles/001D") {
    const samples = { 1: ["EjemploEquipo1.mp4", "Video VcM.mp4"], 2: ["OtroEjemploEquipo2.mp4"], 3: ["EjemploEquipo3.mp4"] };
    candidates.push(...(samples[number] || []).map((filename) => `${folder}/${filename}`));
  }
  return candidates;
}

export function buildVideoBlobUrl(blobName, accountUrl = VIDEO_ACCOUNT_URL, container = VIDEO_CONTAINER) {
  const account = new URL(accountUrl);
  if (account.href !== VIDEO_ACCOUNT_URL || container !== VIDEO_CONTAINER) {
    throw new Error("Invalid local video storage configuration");
  }
  const parts = String(blobName).split("/");
  if (parts.length !== 4 || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || [...part].some((character) => character.charCodeAt(0) < 32))) {
    throw new Error("Invalid video path");
  }
  return `${VIDEO_ACCOUNT_URL}/${container}/${parts.map(encodeURIComponent).join("/")}`;
}

// inspect devuelve null exclusivamente cuando el archivo no existe. Los errores de acceso se propagan.
export async function findTeamVideo(context, team, inspect) {
  const candidates = getVideoCandidates(context, team);
  if (!candidates.length) return { status: "unassigned", url: null };
  for (const blobName of candidates) {
    const found = await inspect(blobName);
    if (found) return { ...found, status: "available", blobName, filename: blobName.split("/").at(-1) };
  }
  return { status: "pending", url: null };
}
