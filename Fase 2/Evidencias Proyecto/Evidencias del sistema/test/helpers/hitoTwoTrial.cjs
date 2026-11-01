// Local rehearsal only. Actual controllers/repositories; SQL and login are simulated.
// There is deliberately no ConnectionPool, credentials, file upload or production URL.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const id = (n) => `6f9619ff-8b86-d011-b42d-${String(n).padStart(12, "0")}`;
const apiRoot = path.resolve(__dirname, "../../api/src");
const nativeRequire = createRequire(path.join(apiRoot, "functions/hitoTwo.js"));
const { AppError } = nativeRequire("../lib/http");
const publicVideoConfig = {
  videoAccountUrl: "http://127.0.0.1:10000/devstoreaccount1", videoContainerName: "vcm-local-videos",
  videoAccessMode: "public", videoUploadEnabled: false, sqlConnectionString: "",
};

function createHitoTwoTrial({ liveVideos = false } = {}) {
  const context = { projectId: id(1), projectCode: "ENSAYO-HITO2", projectName: "Ensayo local · Tres videos",
    partnerId: id(2), partnerName: "Socio ficticio de prueba", contactName: "Contacto ficticio",
    sectionCode: "001D", campusName: "Concepción", subjectName: "Desarrollo de aplicaciones móviles",
    period: "2026-2", teacherName: "Docente ficticio de prueba" };
  const sectionId = id(3), otherSectionId = id(4);
  const teacher = { id: id(9), email: "docente@ensayo.invalid", role: "teacher", canTeach: true };
  let state = { reviews: [], evaluations: {}, progress: null, closed: false, globalClosed: false, audits: [],
    otherSectionClosed: false, hitoThreeClosed: false, lastToken: null, videoReads: [] };
  const teams = [1, 2, 3].map((number) => ({ id: id(20 + number), name: `Equipo ${number}`, videoBlobName: null, videoDeliveryPending: false }));
  const row = (recordset) => ({ recordset: structuredClone(recordset), rowsAffected: [recordset.length] });
  class Request {
    constructor() { this.p = {}; }
    input(name, _type, value) { this.p[name] = value; return this; }
    async query(statement) {
      const p = this.p;
      if (statement.includes("oneSection.estado AS milestoneOneStatus")) {
        if (p.code !== context.projectCode || ![sectionId, otherSectionId].includes(p.sectionId)) return row([]);
        return row([{ ...context, projectStatus: "EN_EJECUCION", milestoneOneStatus: "COMPLETADO", allMilestoneOneStatus: "COMPLETADO",
          milestoneTwoStatus: p.sectionId === sectionId && state.closed ? "COMPLETADO" : "PENDIENTE", available: true,
          teacherAssigned: p.userId === teacher.id && p.sectionId === sectionId,
          closedReviewId: state.progress?.reviewId || null, feedbackReviewedAt: state.progress?.feedbackReviewedAt || null }]);
      }
      if (statement.includes("partner.razon_social AS partnerName")) return row(p.code === context.projectCode && p.sectionId === sectionId ? [context] : []);
      if (statement.includes("r.token_hash = @hash")) return row(state.reviews.filter((review) => review.hash === p.hash && !review.revokedAt
        && Math.min(Date.parse(review.expiresAt), Date.parse(review.deliveredAt) + 21 * 86400000) > Date.now()));
      if (statement.includes("SELECT TOP (1)") && statement.includes("FROM vcm.RevisionSocio")) {
        const found = state.reviews.find((review) => review.sectionId === p.sectionId && (p.reviewId ? review.id === p.reviewId : !review.revokedAt));
        return row(found ? [found] : []);
      }
      if (statement.includes("FROM vcm.EvaluacionSocioEquipo WHERE")) return row(state.evaluations[p.id] || []);
      if (statement.includes("FROM vcm.Equipo") && statement.includes("OUTER APPLY")) return row(p.sectionId === sectionId ? teams : []);
      if (statement.includes("INSERT INTO vcm.RevisionSocio")) {
        state.reviews.forEach((review) => { review.revokedAt ||= new Date().toISOString(); });
        const review = { id: id(100 + state.reviews.length), hash: p.hash, teamsJson: p.teams, projectCode: context.projectCode,
          sectionId: p.sectionId, deliveredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 21 * 86_400_000).toISOString(),
          completedAt: null, closedInternally: false, closedById: null };
        state.reviews.unshift(review); state.evaluations[review.id] = [];
        return row([{ id: review.id, expiresAt: review.expiresAt }]);
      }
      if (statement.includes("MERGE vcm.EvaluacionSocioEquipo")) {
        const saved = { teamId: p.teamId, strengths: p.strengths, improvements: p.improvements, rating: p.rating, reviewedAt: new Date().toISOString() };
        state.evaluations[p.id] = [...state.evaluations[p.id].filter((item) => item.teamId !== p.teamId), saved];
        return row([saved]);
      }
      if (statement.includes("SET completado_en = SYSUTCDATETIME()")) {
        const review = state.reviews.find((item) => item.id === p.id);
        if (statement.includes("cierre_interno = 1")) {
          review.closedInternally = true; review.closedById = p.actorId; review.closedByName = context.teacherName;
        }
        review.completedAt = new Date().toISOString(); return row([{ completedAt: review.completedAt }]);
      }
      if (statement.includes("AS databaseId")) return row([{ ...context, databaseId: context.projectId, id: context.projectCode,
        name: context.projectName, subjectId: id(5), status: "EN_EJECUCION", teacherAssigned: true, createdBy: teacher.id,
        milestoneTwoStarted: state.reviews.length > 0 }]);
      if (statement.includes("AS teacherAssigned")) return row(p.code === context.projectCode ? [{ id: context.projectId, subjectId: id(5), status: "EN_EJECUCION", teacherAssigned: p.userId === teacher.id }] : []);
      if (statement.includes("AS id, section.codigo AS code")) return row(p.sectionId === sectionId && p.userId === teacher.id ? [{ id: sectionId, code: "001D" }] : []);
      if (statement.includes("milestoneOne.estado AS milestoneOneStatus")) return row([{ milestoneOneStatus: "COMPLETADO", availableFrom: "2026-01-01", available: true }]);
      if (statement.includes("SELECT numero AS number, estado AS status")) return row([{ number: 1, status: "COMPLETADO" }, { number: 2, status: state.closed ? "COMPLETADO" : "PENDIENTE" }]);
      if (statement.includes("MERGE vcm.AvanceProyectoSeccion")) {
        if (p.sectionId !== sectionId) throw new Error("Trial attempted to close another section");
        state.progress = { projectId: context.projectId, sectionId, advance: p.advance, conclusions: p.conclusions,
          reviewId: p.reviewId, feedbackReviewedAt: new Date().toISOString(), registeredAt: new Date().toISOString() };
        state.closed = true; return row([]);
      }
      if (statement.includes("UPDATE projectMilestone")) { state.globalClosed = state.closed && state.otherSectionClosed; return row([]); }
      if (statement.includes("FROM vcm.ProyectoSede link")) return row([{ projectId: context.projectId, campusId: id(6) }]);
      if (statement.includes("FROM vcm.ProyectoSeccion link")) return row([sectionId, otherSectionId].map((section) => ({ projectId: context.projectId, sectionId: section, campusId: id(6) })));
      if (statement.includes("FROM vcm.HitoProyectoSeccion;")) return row([sectionId, otherSectionId].flatMap((section) => [1, 2, 3].map((number) => ({
        projectId: context.projectId, sectionId: section, number, status: number === 1 || (number === 2 && section === sectionId && state.closed) ? "COMPLETADO" : "PENDIENTE",
        completedAt: number === 2 && section === sectionId ? state.progress?.registeredAt : null,
      }))));
      if (statement.includes("FROM vcm.HitoProyecto;")) return row([1, 2, 3].map((number) => ({ projectId: context.projectId, number,
        status: number === 1 || (number === 2 && state.globalClosed) ? "COMPLETADO" : "PENDIENTE", available: true, availableFrom: "2026-01-01" })));
      if (statement.includes("FROM vcm.AvanceProyectoSeccion;")) return row(state.progress ? [{ ...state.progress, conclusiones: state.progress.conclusions }] : []);
      if (statement.includes("AS teacherName") && statement.includes("FROM vcm.ProyectoSeccion projectSection")) return row([{ projectId: context.projectId, sectionId, teacherId: teacher.id, teacherName: context.teacherName }]);
      if (statement.includes("FROM vcm.ProyectoSeccion projectSection") && statement.includes("SELECT DISTINCT")) return row([{ projectId: context.projectId, sectionId }]);
      if (statement.includes("FROM vcm.Equipo team ORDER")) return row(teams.map((team) => ({ ...team, projectId: context.projectId, sectionId })));
      if (statement.includes("FROM vcm.EquipoAlumno membership;") || statement.includes("FROM vcm.ArchivoProyecto;")) return row([]);
      throw new Error(`Unsupported trial query: ${statement.slice(0, 100)}`);
    }
  }
  const db = { sql: { Request, UniqueIdentifier: "uuid", TinyInt: "int", MAX: -1, NVarChar: () => "text", VarChar: () => "text", Char: () => "text" },
    getPool: async () => ({ request: () => new Request() }), withTransaction: async (operation) => {
      const snapshot = structuredClone(state);
      try { return await operation({}); } catch (error) { state = snapshot; throw error; }
    } };
  const registry = new Map(), cache = new Map();
  const isolated = new Set(["lib/hitoTwoWorkflow.js", "repositories/partnerReviewRepository.js", "repositories/projectRepository.js",
    "functions/hitoTwo.js", "functions/partnerReviews.js", "functions/projects.js"].map((file) => path.join(apiRoot, file)));
  const auth = {
    requireRole: async (request, roles) => {
      const role = request.headers.get("x-trial-role") || "teacher";
      if (!roles.includes(role)) throw new AppError(403, "ROLE_REQUIRED", "Rol de ensayo no autorizado.");
      return { ...teacher, role };
    },
    requireTeachingCapability: async (request) => auth.requireRole(request, ["teacher"]),
    requireUser: async (request) => auth.requireRole(request, ["teacher"]),
  };
  const videos = nativeRequire("../lib/partnerVideos");
  const fakeStorage = { getBlobClient: (name) => ({ getProperties: async () => {
    if (!["EjemploEquipo1.mp4", "OtroEjemploEquipo2.mp4", "EjemploEquipo3.mp4"].some((file) => name.endsWith(`/${file}`))) {
      throw Object.assign(new Error("Missing trial video"), { statusCode: 404, code: "BlobNotFound" });
    }
    return { contentLength: 330000, contentType: "video/mp4" };
  } }) };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const localRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module, require: (specifier) => {
      if (specifier === "@azure/functions") return { app: { http: (key, route) => registry.set(key, route) } };
      const resolved = localRequire.resolve(specifier);
      if (resolved === path.join(apiRoot, "lib/db.js")) return db;
      if (resolved === path.join(apiRoot, "lib/config.js")) return { getConfig: () => ({ ...publicVideoConfig }) };
      if (resolved === path.join(apiRoot, "lib/auth.js")) return auth;
      if (resolved === path.join(apiRoot, "lib/audit.js")) return { writeAudit: async (_tx, _actor, event) => state.audits.push(structuredClone(event)) };
      if (resolved === path.join(apiRoot, "lib/partnerVideos.js")) return { ...videos, resolvePartnerVideo: async (scope, team, options) => {
        const result = await videos.resolvePartnerVideo(scope, team, { ...options, config: publicVideoConfig, ...(!liveVideos ? { storage: fakeStorage } : {}) });
        state.videoReads.push({ team: team.name, filename: result.filename, live: liveVideos }); return result;
      } };
      return isolated.has(resolved) ? load(resolved) : localRequire(specifier);
    } }, { filename });
    return module.exports;
  }
  for (const file of ["functions/hitoTwo.js", "functions/partnerReviews.js", "functions/projects.js"]) load(path.join(apiRoot, file));
  const allowed = new Set(["sectionHitoTwo", "closeSectionPartnerReview", "partnerReview", "partnerReviewVideo", "savePartnerEvaluation", "completePartnerReview", "saveProjectProgress"]);
  async function dispatch(method, url, body, headers = {}) {
    const pathname = new URL(url, "http://127.0.0.1").pathname.replace(/^\/api\//, "");
    for (const [name, route] of registry) {
      if (!allowed.has(name) || !route.methods.includes(method)) continue;
      const names = [];
      const expression = route.route.replace(/\{(\w+)\}/g, (_match, key) => { names.push(key); return "([^/]+)"; });
      const match = pathname.match(new RegExp(`^${expression}$`));
      if (!match) continue;
      const request = { method, url: `http://127.0.0.1/api/${pathname}`, headers: new Headers(headers),
        params: Object.fromEntries(names.map((key, index) => [key, decodeURIComponent(match[index + 1])])), json: async () => body };
      const result = await route.handler(request, { error: (...args) => { throw new Error(args.map(String).join(" ")); } });
      if (name === "sectionHitoTwo" && method === "POST" && result.jsonBody?.data?.token) state.lastToken = result.jsonBody.data.token;
      return result;
    }
    return { status: 404, jsonBody: { error: { code: "TRIAL_ROUTE_ONLY", message: "Esta ruta no está disponible en el ensayo local." } } };
  }
  return { dispatch, context, sectionId, otherSectionId, teacher,
    get snapshot() { return structuredClone(state); },
    info() { return { projectId: context.projectCode, sectionId, sectionCode: context.sectionCode,
      reviewPath: state.lastToken ? `/revision-socio#${state.lastToken}` : null,
      closed: state.closed, progress: state.progress, sqlSimulated: true, liveVideos,
      otherSectionClosed: state.otherSectionClosed, hitoThreeClosed: state.hitoThreeClosed, globalClosed: state.globalClosed }; },
  };
}
module.exports = { createHitoTwoTrial };
