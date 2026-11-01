import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { campuses, initialPartners, initialProjects, initialStudents, sections, subjects } from "../data/catalogs";
import { getCurrentSession, login as loginRequest, logout as logoutRequest } from "../services/authApi";
import { getAcademicCatalogs } from "../services/academicApi";
import {
  addProjectStudent as addProjectStudentRequest,
  closeProject as closeProjectRequest,
  createPartner as createPartnerRequest,
  createProject as createProjectRequest,
  deleteProject as deleteProjectRequest,
  deleteProjectFile as deleteProjectFileRequest,
  downloadProjectFile as downloadProjectFileRequest,
  getProjectRoster as getProjectRosterRequest,
  listPartners,
  listProjects,
  reopenProjectMilestone as reopenProjectMilestoneRequest,
  removeProjectStudent as removeProjectStudentRequest,
  saveProjectProgress as saveProjectProgressRequest,
  scheduleProjectMilestoneTwo as scheduleProjectMilestoneTwoRequest,
  startProject as startProjectRequest,
  updatePartner as updatePartnerRequest,
  updateProject as updateProjectRequest,
  updateProjectStudentAssignment as updateProjectStudentAssignmentRequest,
  uploadProjectFile as uploadProjectFileRequest,
} from "../services/coreApi";

const AppContext = createContext(null);
const STORAGE_PREFIX = "vcm-piloto-2026-local";
const DEMO_MODE = false; // La API local debe confirmar cada operación; sin respaldo silencioso.
const EMPTY_CATALOGS = { campuses: [], schools: [], subjects: [], sections: [], studentCount: 0, source: "unavailable" };

function loadStored(key, fallback) {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
}

function getProjectAttachments(project) {
  if (Array.isArray(project.attachments)) return project.attachments;
  if (project.attachment) return [project.attachment];
  if (project.attachmentId && project.attachmentName) {
    return [{ id: project.attachmentId, name: project.attachmentName }];
  }
  return [];
}

function withProjectAttachments(project, attachments) {
  const latest = attachments[0] || null;
  return {
    ...project,
    attachments,
    attachmentId: latest?.id || null,
    attachmentName: latest?.name || null,
    attachment: latest,
  };
}

export function AppProvider({ children }) {
  const [session, setSessionState] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [partners, setPartners] = useState(() => DEMO_MODE ? loadStored("partners", initialPartners) : []);
  const [projects, setProjects] = useState(() => DEMO_MODE ? loadStored("projects", initialProjects) : []);
  const [catalogs, setCatalogs] = useState(DEMO_MODE
    ? { campuses, schools: [], subjects, sections, studentCount: initialStudents.length, source: "demo" }
    : EMPTY_CATALOGS);
  const [dataSource, setDataSource] = useState(DEMO_MODE ? "demo" : "unavailable");
  const [dataError, setDataError] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  const refreshOperationalData = useCallback(async () => {
    setLoadingData(true);
    setDataReady(false);
    setDataError("");
    try {
      const [nextPartners, nextProjects, nextCatalogs] = await Promise.all([listPartners(), listProjects(), getAcademicCatalogs()]);
      setPartners(nextPartners);
      setProjects(nextProjects);
      setCatalogs(nextCatalogs);
      setDataSource(nextCatalogs.source === "vcm_piloto_2026_local" ? "api" : "demo");
    } catch (error) {
      if (!DEMO_MODE) {
        setPartners([]);
        setProjects([]);
        setCatalogs(EMPTY_CATALOGS);
        setDataSource("unavailable");
        setDataError(error.message || "No fue posible conectar con Azure SQL.");
      } else {
        setDataSource("demo");
      }
    } finally {
      setLoadingData(false);
      setDataReady(true);
    }
  }, []);

  useEffect(() => {
    if (session) refreshOperationalData();
  }, [session, refreshOperationalData]);

  useEffect(() => {
    localStorage.removeItem(`${STORAGE_PREFIX}:session`);
    getCurrentSession()
      .then(setSessionState)
      .catch(() => setSessionState(null))
      .finally(() => setSessionLoading(false));
  }, []);

  const login = async (email, password, options) => {
    const profile = await loginRequest(email, password, options);
    setSessionState(profile);
    return profile;
  };

  const logout = async () => {
    try {
      await logoutRequest();
    } catch {
      // La interfaz debe cerrar igualmente una sesión local inválida o expirada.
    } finally {
      setSessionState(null);
      setDataReady(false);
    }
  };

  const addPartner = async (partner) => {
    try {
      const created = await createPartnerRequest(partner);
      setPartners((current) => [...current.filter((item) => item.id !== created.id), created].sort((left, right) => left.businessName.localeCompare(right.businessName)));
      setDataSource("api");
      return created;
    } catch (error) {
      if (!DEMO_MODE) throw error;
      const created = { ...partner, id: crypto.randomUUID() };
      const next = [...partners, created];
      setPartners(next);
      saveStored("partners", next);
      return created;
    }
  };

  const addProject = async (project, attachmentFile = null) => {
    try {
      const created = await createProjectRequest(project);
      let nextProject = created;
      if (attachmentFile) {
        try {
          const attachment = await uploadProjectFileRequest(created.id, "ANTECEDENTE", attachmentFile);
          nextProject = withProjectAttachments(created, [attachment]);
        } catch (uploadError) {
          nextProject = { ...created, attachmentUploadError: uploadError.message };
        }
      }
      setProjects((current) => [nextProject, ...current.filter((item) => item.id !== created.id)]);
      setDataSource("api");
      return nextProject;
    } catch (error) {
      if (!DEMO_MODE) throw error;
      const nextNumber = String(projects.length + 1).padStart(3, "0");
      const demoAttachmentId = attachmentFile ? crypto.randomUUID() : null;
      const nextProject = {
        ...project,
        id: `VCM-2026-${nextNumber}`,
        createdBy: session.id,
        coordinatorName: session.name,
        coordinatorTitle: session.title,
        sectionIds: project.sectionIds,
        startDate: null,
        endDate: null,
        teacherIds: [],
        status: "Planificado",
        attachmentId: demoAttachmentId,
        attachmentName: attachmentFile?.name || null,
        attachment: attachmentFile ? { id: demoAttachmentId, name: attachmentFile.name, size: attachmentFile.size, contentType: attachmentFile.type, uploadedBy: session.id, canDelete: ["admin", "coordinator"].includes(session.role) } : null,
        attachments: attachmentFile ? [{ id: demoAttachmentId, name: attachmentFile.name, size: attachmentFile.size, contentType: attachmentFile.type, uploadedBy: session.id, canDelete: ["admin", "coordinator"].includes(session.role) }] : [],
        teams: [],
        progress: null,
        milestones: [
          { id: 1, name: "Inicio y equipos", status: "Pendiente", completedAt: null },
          { id: 2, name: "Avance y resultados", status: "Pendiente", completedAt: null },
          { id: 3, name: "Cierre", status: "Pendiente", completedAt: null },
        ],
      };
      const next = [nextProject, ...projects];
      setProjects(next);
      saveStored("projects", next);
      return nextProject;
    }
  };

  const updateDemoProject = (projectId, updater) => {
    if (!DEMO_MODE) {
      throw new Error("Esta operación aún no está habilitada en el backend del piloto.");
    }
    const next = projects.map((project) => project.id === projectId ? updater(project) : project);
    setProjects(next);
    saveStored("projects", next);
  };

  const editProject = async (projectId, project) => {
    try {
      const updated = await updateProjectRequest(projectId, project);
      setProjects((current) => current.map((item) => item.id === projectId ? updated : item));
      setDataSource("api");
      return updated;
    } catch (error) {
      if (!DEMO_MODE) throw error;
      const updated = { ...projects.find((item) => item.id === projectId), ...project };
      const next = projects.map((item) => item.id === projectId ? updated : item);
      setProjects(next);
      saveStored("projects", next);
      return updated;
    }
  };

  const deleteProject = async (projectId, confirmationCode) => {
    try {
      const result = await deleteProjectRequest(projectId, confirmationCode);
      setProjects((current) => current.filter((item) => item.id !== projectId));
      setDataSource("api");
      return result;
    } catch (error) {
      if (!DEMO_MODE) throw error;
      const next = projects.filter((item) => item.id !== projectId);
      setProjects(next);
      saveStored("projects", next);
      return { id: projectId, deleted: true, storageCleaned: true, pendingFileCleanup: 0 };
    }
  };

  const getProjectRoster = useCallback((projectId) => getProjectRosterRequest(projectId), []);
  const addProjectStudent = useCallback((projectId, student) => addProjectStudentRequest(projectId, student), []);
  const removeProjectStudent = useCallback((projectId, studentId, sectionId) => removeProjectStudentRequest(projectId, studentId, sectionId), []);

  const uploadProjectFile = async (projectId, category, file, sectionId = null, replaceFileId = null) => {
    if (DEMO_MODE && dataSource !== "api") {
      const uploaded = {
        id: replaceFileId || crypto.randomUUID(), name: file.name, size: file.size, contentType: file.type,
        sectionId, category, uploadedAt: new Date().toISOString(), uploadedBy: session.id,
        canDelete: category === "ANTECEDENTE" && ["admin", "coordinator"].includes(session.role),
      };
      updateDemoProject(projectId, (project) => {
        if (category === "ANTECEDENTE") {
          const currentAttachments = getProjectAttachments(project);
          const nextAttachments = replaceFileId
            ? currentAttachments.map((attachment) => attachment.id === replaceFileId ? uploaded : attachment)
            : [uploaded, ...currentAttachments];
          return withProjectAttachments(project, nextAttachments);
        }
        return {
          ...project,
          sectionStates: (project.sectionStates || []).map((state) => state.sectionId === sectionId
            ? { ...state, progress: { ...(state.progress || {}), deliverableId: uploaded.id, deliverableName: uploaded.name, deliverable: uploaded } }
            : state),
        };
      });
      return uploaded;
    }
    const uploaded = await uploadProjectFileRequest(projectId, category, file, sectionId, replaceFileId);
    setProjects((current) => current.map((project) => {
      if (project.id !== projectId) return project;
      if (category === "ANTECEDENTE") {
        const currentAttachments = getProjectAttachments(project);
        const nextAttachments = replaceFileId
          ? currentAttachments.map((attachment) => attachment.id === replaceFileId ? uploaded : attachment)
          : [uploaded, ...currentAttachments];
        return withProjectAttachments(project, nextAttachments);
      }
      return {
        ...project,
        sectionStates: (project.sectionStates || []).map((state) => state.sectionId === sectionId
          ? { ...state, progress: { ...(state.progress || {}), deliverableId: uploaded.id, deliverableName: uploaded.name, deliverable: uploaded } }
          : state),
      };
    }));
    return uploaded;
  };

  const editPartner = async (partnerId, partner) => {
    try {
      const updated = await updatePartnerRequest(partnerId, partner);
      setPartners((current) => current
        .map((item) => item.id === partnerId ? updated : item)
        .sort((left, right) => left.businessName.localeCompare(right.businessName, "es")));
      setDataSource("api");
      return updated;
    } catch (error) {
      if (!DEMO_MODE) throw error;
      const updated = { ...partner, id: partnerId };
      const next = partners.map((item) => item.id === partnerId ? updated : item);
      setPartners(next);
      saveStored("partners", next);
      return updated;
    }
  };

  const downloadProjectFile = (projectId, fileId) => {
    if (DEMO_MODE && dataSource !== "api") {
      throw new Error("La descarga real está disponible al conectar el proyecto con Azure Blob Storage.");
    }
    return downloadProjectFileRequest(projectId, fileId);
  };

  const deleteProjectFile = async (projectId, fileId) => {
    if (DEMO_MODE && dataSource !== "api") {
      const target = projects.find((project) => project.id === projectId);
      const targetAttachment = getProjectAttachments(target || {}).find((attachment) => attachment.id === fileId);
      const canDelete = session.role === "admin"
        || (session.role === "coordinator" && targetAttachment?.uploadedBy === session.id);
      if (!canDelete) {
        throw new Error("Sólo un Administrador o el Coordinador CITT que subió este archivo puede eliminarlo.");
      }
      if (["Finalizado", "Cancelado"].includes(target.status)) {
        throw new Error("El archivo no puede eliminarse porque el proyecto ya está cerrado.");
      }
      updateDemoProject(projectId, (project) => withProjectAttachments(
        project,
        getProjectAttachments(project).filter((attachment) => attachment.id !== fileId),
      ));
      return { id: fileId, deleted: true, storageCleaned: true };
    }
    const result = await deleteProjectFileRequest(projectId, fileId);
    setProjects((current) => current.map((project) => project.id === projectId
      ? withProjectAttachments(project, getProjectAttachments(project).filter((attachment) => attachment.id !== fileId))
      : project));
    return result;
  };

  const startProject = async (projectId, teams, students) => {
    const result = await startProjectRequest(projectId, teams, students);
    if (result.project) {
      setProjects((current) => current.map((project) => project.id === projectId ? result.project : project));
    }
    setDataSource("api");
    return result;
  };

  const updateProjectStudentAssignment = (projectId, studentId, assignment) => (
    updateProjectStudentAssignmentRequest(projectId, studentId, assignment)
  );

  const saveProgress = async (projectId, sectionId, progress) => {
    if (DEMO_MODE && dataSource !== "api") {
      updateDemoProject(projectId, (project) => ({
        ...project,
        progress,
        milestones: project.milestones.map((milestone) => milestone.id === 2
          ? { ...milestone, status: "Completado", completedAt: new Date().toISOString() }
          : milestone),
      }));
      return;
    }
    const result = await saveProjectProgressRequest(projectId, sectionId, progress);
    if (result.project) {
      setProjects((current) => current.map((project) => project.id === projectId ? result.project : project));
    }
  };

  const closeProject = async (projectId, sectionId) => {
    if (DEMO_MODE && dataSource !== "api") {
      updateDemoProject(projectId, (project) => ({
        ...project,
        status: "Finalizado",
        milestones: project.milestones.map((milestone) => milestone.id === 3
          ? { ...milestone, status: "Completado", completedAt: new Date().toISOString() }
          : milestone),
      }));
      return;
    }
    const result = await closeProjectRequest(projectId, sectionId);
    if (result.project) {
      setProjects((current) => current.map((project) => project.id === projectId ? result.project : project));
    }
  };

  const scheduleMilestoneTwo = async (projectId, availableFrom) => {
    const result = await scheduleProjectMilestoneTwoRequest(projectId, availableFrom);
    if (result.project) {
      setProjects((current) => current.map((project) => project.id === projectId ? result.project : project));
    }
    return result;
  };

  const reopenMilestone = async (projectId, sectionId, milestoneNumber, reason) => {
    const result = await reopenProjectMilestoneRequest(projectId, sectionId, milestoneNumber, reason);
    if (result.project) {
      setProjects((current) => current.map((project) => project.id === projectId ? result.project : project));
    }
    return result;
  };

  const teachingProjects = useMemo(() => {
    if (!session) return [];
    if (!session.canTeach && session.role !== "teacher") return [];
    if (dataSource === "api") return projects.filter((project) => project.teacherAssigned);
    return projects.filter((project) => project.teacherIds.includes(session.id)
      || project.teacherEmails?.includes(session.email));
  }, [dataSource, projects, session]);

  const visibleProjects = useMemo(() => {
    if (!session) return [];
    return session.role === "teacher" ? teachingProjects : projects;
  }, [projects, session, teachingProjects]);

  const value = {
    session,
    sessionLoading,
    partners,
    projects,
    catalogs,
    dataSource,
    dataError,
    loadingData,
    dataReady,
    visibleProjects,
    teachingProjects,
    login,
    logout,
    addPartner,
    editPartner,
    addProject,
    editProject,
    deleteProject,
    uploadProjectFile,
    downloadProjectFile,
    deleteProjectFile,
    getProjectRoster,
    addProjectStudent,
    removeProjectStudent,
    startProject,
    updateProjectStudentAssignment,
    saveProgress,
    closeProject,
    scheduleMilestoneTwo,
    reopenMilestone,
    refreshOperationalData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp debe utilizarse dentro de AppProvider");
  return context;
}
