import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Flag,
  LoaderCircle,
  MapPin,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  School,
  Trash2,
  TriangleAlert,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Card, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "../components/UI";
import { useApp } from "../context/AppContext";
import PartnerReviewManager from "../components/PartnerReviewManager";
import HitoTwoPanel from "../components/HitoTwoPanel";

const TEAM_NUMBERS = Array.from({ length: 20 }, (_, index) => String(index + 1));
const EMPTY_PROJECT_EDIT = { partnerId: "", name: "", description: "", expectedResult: "", subjectId: "", campusIds: [], sectionIds: [] };
const EMPTY_MANUAL_STUDENT = { name: "", rut: "" };

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    session, partners, visibleProjects, catalogs, loadingData, dataReady,
    getProjectRoster, addProjectStudent, removeProjectStudent, startProject, updateProjectStudentAssignment, saveProgress, closeProject,
    scheduleMilestoneTwo, reopenMilestone, uploadProjectFile, downloadProjectFile, deleteProjectFile, editProject,
    deleteProject: removeProject,
  } = useApp();
  const project = visibleProjects.find((item) => item.id === projectId);
  const [roster, setRoster] = useState([]);
  const [teamAssignments, setTeamAssignments] = useState({});
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [progress, setProgress] = useState({ advance: "", conclusions: "", deliverableName: "" });
  const [antecedentFile, setAntecedentFile] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [replacingFileId, setReplacingFileId] = useState("");
  const replaceInputRef = useRef(null);
  const replaceTargetRef = useRef(null);
  const [notice, setNotice] = useState(location.state?.uploadWarning
    ? { tone: "error", text: `La propuesta fue creada, pero el documento no pudo subirse: ${location.state.uploadWarning}` }
    : location.state?.created ? { tone: "success", text: "La propuesta fue creada correctamente." } : null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [starting, setStarting] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState("");
  const [showStudentAdd, setShowStudentAdd] = useState(false);
  const [manualStudent, setManualStudent] = useState(EMPTY_MANUAL_STUDENT);
  const [manualStudentError, setManualStudentError] = useState("");
  const [addingStudent, setAddingStudent] = useState(false);
  const [removeStudentTarget, setRemoveStudentTarget] = useState(null);
  const [removingStudent, setRemovingStudent] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [closing, setClosing] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [adminSectionId, setAdminSectionId] = useState("");
  const [reopenTarget, setReopenTarget] = useState(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [showProjectEditor, setShowProjectEditor] = useState(false);
  const [projectEditForm, setProjectEditForm] = useState(EMPTY_PROJECT_EDIT);
  const [projectEditError, setProjectEditError] = useState("");
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);
  const [projectDeleteStep, setProjectDeleteStep] = useState(0);
  const [projectDeleteConfirmation, setProjectDeleteConfirmation] = useState("");
  const [projectDeleteError, setProjectDeleteError] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);

  const campusMap = useMemo(() => new Map(catalogs.campuses.map((item) => [item.id, item])), [catalogs.campuses]);
  const subjectMap = useMemo(() => new Map(catalogs.subjects.map((item) => [item.id, item])), [catalogs.subjects]);
  const sectionMap = useMemo(() => new Map(catalogs.sections.map((item) => [item.id, item])), [catalogs.sections]);
  const availableEditSections = useMemo(() => catalogs.sections.filter((section) =>
    section.subjectId === projectEditForm.subjectId && projectEditForm.campusIds.includes(section.campusId)), [catalogs.sections, projectEditForm.subjectId, projectEditForm.campusIds]);

  const canManageTeaching = Boolean(session.canTeach && project?.teacherAssigned);
  const canAdministerMilestones = ["admin", "coordinator"].includes(session.role);
  const canManageAntecedents = canAdministerMilestones && !["Finalizado", "Cancelado"].includes(project?.status);
  const displayedProjectStatus = session.role === "teacher" ? project?.teachingStatus || project?.status : project?.status;
  const selectedSectionState = project?.sectionStates?.find((item) => item.sectionId === selectedSectionId);

  useEffect(() => {
    let active = true;
    if (!canManageTeaching || !project) return undefined;
    setLoadingRoster(true);
    getProjectRoster(project.id)
      .then((students) => {
        if (!active) return;
        setRoster(students);
        setTeamAssignments(Object.fromEntries(students.map((student) => [student.id, getStudentAssignmentValue(student)])));
        const sectionIds = project.teachingSectionIds?.length
          ? project.teachingSectionIds
          : [...new Set(students.map((student) => student.sectionId))];
        const firstPendingSectionId = sectionIds.find((sectionId) => project.sectionStates
          ?.find((item) => item.sectionId === sectionId)?.milestones?.[0]?.status !== "Completado");
        setSelectedSectionId((current) => sectionIds.includes(current) ? current : (firstPendingSectionId || sectionIds[0] || ""));
      })
      .catch((error) => {
        if (active) setNotice({ tone: "error", text: error.message });
      })
      .finally(() => {
        if (active) setLoadingRoster(false);
      });
    return () => { active = false; };
  }, [canManageTeaching, getProjectRoster, project]);

  useEffect(() => {
    setProgress(selectedSectionState?.progress || { advance: "", conclusions: "", deliverableName: "" });
  }, [selectedSectionId, selectedSectionState?.progress]);

  useEffect(() => {
    setScheduleDate(project?.milestones?.[1]?.availableFrom || "");
    const sectionIds = project?.sectionIds || [];
    const requestedSectionId = new URLSearchParams(location.search).get("section");
    setAdminSectionId((current) => sectionIds.includes(requestedSectionId)
      ? requestedSectionId
      : sectionIds.includes(current) ? current : (sectionIds[0] || ""));
  }, [location.search, project]);

  useEffect(() => {
    if (project && location.hash === "#control-hitos") {
      requestAnimationFrame(() => document.getElementById("control-hitos")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [location.hash, project]);

  if (!project && (!dataReady || loadingData)) return <div className="session-loader" role="status">Cargando proyecto...</div>;
  if (!project) return <Navigate to="/app" replace />;

  const partner = partners.find((item) => item.id === project.partnerId);
  const subject = subjectMap.get(project.subjectId);
  const rosterBySection = roster.reduce((groups, student) => {
    if (!groups.has(student.sectionId)) groups.set(student.sectionId, []);
    groups.get(student.sectionId).push(student);
    return groups;
  }, new Map());
  const teachingSectionIds = project.teachingSectionIds?.length
    ? project.teachingSectionIds
    : [...rosterBySection.keys()];
  const rosterSections = teachingSectionIds.map((sectionId) => {
    const students = rosterBySection.get(sectionId) || [];
    const catalogSection = sectionMap.get(sectionId);
    return {
      id: sectionId,
      code: students[0]?.sectionCode || catalogSection?.code || "Sin código",
      campusName: students[0]?.campusName || campusMap.get(catalogSection?.campusId)?.name || "Sede sin identificar",
      students,
    };
  }).sort((left, right) => `${left.campusName}|${left.code}`.localeCompare(`${right.campusName}|${right.code}`, "es"));
  const selectedRoster = rosterSections.find((section) => section.id === selectedSectionId)?.students || [];
  const selectedSection = rosterSections.find((section) => section.id === selectedSectionId);
  const hito1Done = selectedSectionState?.milestones?.[0]?.status === "Completado";
  const hito2Done = selectedSectionState?.milestones?.[1]?.status === "Completado";
  const hito3Done = selectedSectionState?.milestones?.[2]?.status === "Completado";
  const canEditRoster = canManageTeaching && Boolean(selectedSection) && !hito3Done && !["Finalizado", "Cancelado"].includes(project.status);
  const hito2Available = project.milestones[0].status === "Completado" && Boolean(project.milestones[1].available);
  const administrativeSections = project.sectionIds.map((sectionId) => {
    const section = sectionMap.get(sectionId);
    return {
      id: sectionId,
      code: section?.code || "Sin código",
      campusName: campusMap.get(section?.campusId)?.name || "Sede sin identificar",
    };
  }).sort((left, right) => `${left.campusName}|${left.code}`.localeCompare(`${right.campusName}|${right.code}`, "es"));
  const projectAttachments = Array.isArray(project.attachments)
    ? project.attachments
    : project.attachment ? [project.attachment] : [];

  const assignStudent = (studentId, groupNumber) => setTeamAssignments((current) => ({ ...current, [studentId]: groupNumber }));

  const handleStart = async () => {
    if (!selectedSectionId || !selectedRoster.length) {
      setNotice({ tone: "error", text: "Selecciona una sección con estudiantes para conformar sus equipos." });
      return;
    }
    const grouped = new Map();
    selectedRoster.forEach((student) => {
      const number = teamAssignments[student.id] || "SIN_EQUIPO";
      if (!TEAM_NUMBERS.includes(number)) return;
      const key = `${student.sectionId}|${number}`;
      if (!grouped.has(key)) grouped.set(key, { sectionId: student.sectionId, name: `Equipo ${number}`, studentIds: [] });
      grouped.get(key).studentIds.push(student.id);
    });
    const studentStates = selectedRoster.map((student) => {
      const selection = teamAssignments[student.id] || "SIN_EQUIPO";
      return {
        studentId: student.id,
        sectionId: student.sectionId,
        status: TEAM_NUMBERS.includes(selection) ? "ASIGNADO" : selection,
      };
    });
    setStarting(true);
    try {
      const result = await startProject(project.id, [...grouped.values()], studentStates);
      const sectionLabel = rosterSections.find((section) => section.id === result.sectionId)?.code || "seleccionada";
      const assignedCount = studentStates.filter((student) => student.status === "ASIGNADO").length;
      const withoutTeamCount = studentStates.filter((student) => student.status === "SIN_EQUIPO").length;
      const dropoutCount = studentStates.filter((student) => student.status === "DESERTOR").length;
      setNotice({
        tone: "success",
        text: `El Hito 1 de la sección ${sectionLabel} quedó completado: ${assignedCount} asignados, ${withoutTeamCount} sin equipo y ${dropoutCount} desertores. ${result.completedSections} de ${result.totalSections} secciones del proyecto ya completaron este hito.`,
      });
      const nextPendingSection = rosterSections.find((section) => section.id !== result.sectionId
        && result.project?.sectionStates?.find((item) => item.sectionId === section.id)?.milestones?.[0]?.status !== "Completado");
      if (nextPendingSection) setSelectedSectionId(nextPendingSection.id);
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setStarting(false);
    }
  };

  const handleProgress = async (event, reviewId) => {
    event.preventDefault();
    if (savingProgress) return false;
    if (!reviewId) {
      setNotice({ tone: "error", text: "Revisa la retroalimentación final de tu sección antes de cerrar el Hito 2." });
      return false;
    }
    if (!progress.advance || !progress.conclusions) {
      setNotice({ tone: "error", text: "Completa el avance y las conclusiones antes de registrar el hito 2." });
      return false;
    }
    setSavingProgress(true);
    try {
      await saveProgress(project.id, selectedSectionId, { advance: progress.advance, conclusions: progress.conclusions, reviewId, feedbackReviewed: true });
      setNotice({ tone: "success", text: `El Hito 2 de la sección ${selectedSection?.code} quedó cerrado tras revisar la retroalimentación del socio formador.` });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
      throw error;
    } finally {
      setSavingProgress(false);
    }
  };

  const handleAntecedentUpload = async () => {
    if (!antecedentFile) return;
    setUploadingFile(true);
    try {
      await uploadProjectFile(project.id, "ANTECEDENTE", antecedentFile);
      setAntecedentFile(null);
      setNotice({ tone: "success", text: "El nuevo documento de antecedentes quedó almacenado correctamente." });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleStudentAssignmentUpdate = async (student) => {
    const selection = teamAssignments[student.id] || "SIN_EQUIPO";
    const assignment = TEAM_NUMBERS.includes(selection)
      ? { sectionId: student.sectionId, status: "ASIGNADO", teamNumber: Number(selection) }
      : { sectionId: student.sectionId, status: selection, teamNumber: null };
    setSavingStudentId(student.id);
    try {
      const updated = await updateProjectStudentAssignment(project.id, student.id, assignment);
      setRoster((current) => current.map((item) => item.id === student.id ? updated : item));
      setTeamAssignments((current) => ({ ...current, [student.id]: getStudentAssignmentValue(updated) }));
      setNotice({
        tone: "success",
        text: `${updated.name} quedó ${formatStudentAssignment(updated).toLowerCase()}. El Hito 1 permanece completado.`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setSavingStudentId("");
    }
  };

  const openStudentAdd = () => {
    setManualStudent(EMPTY_MANUAL_STUDENT);
    setManualStudentError("");
    setShowStudentAdd(true);
  };

  const handleManualStudentAdd = async (event) => {
    event.preventDefault();
    if (!selectedSectionId || !manualStudent.name.trim() || !manualStudent.rut.trim()) {
      setManualStudentError("Completa el nombre y el RUT del estudiante.");
      return;
    }
    setAddingStudent(true);
    setManualStudentError("");
    try {
      const createdStudent = await addProjectStudent(project.id, {
        sectionId: selectedSectionId,
        name: manualStudent.name,
        rut: manualStudent.rut,
      });
      setRoster((current) => [...current.filter((student) => student.id !== createdStudent.id), createdStudent]
        .sort((left, right) => left.name.localeCompare(right.name, "es")));
      setTeamAssignments((current) => ({ ...current, [createdStudent.id]: "SIN_EQUIPO" }));
      setShowStudentAdd(false);
      setManualStudent(EMPTY_MANUAL_STUDENT);
      setNotice({ tone: "success", text: `${createdStudent.name} fue agregado a la sección ${selectedSection?.code} y quedó sin equipo.` });
    } catch (error) {
      setManualStudentError(error.message);
    } finally {
      setAddingStudent(false);
    }
  };

  const handleStudentRemoval = async () => {
    if (!removeStudentTarget) return;
    setRemovingStudent(true);
    try {
      await removeProjectStudent(project.id, removeStudentTarget.id, removeStudentTarget.sectionId);
      setRoster((current) => current.filter((student) => student.id !== removeStudentTarget.id));
      setTeamAssignments((current) => {
        const next = { ...current };
        delete next[removeStudentTarget.id];
        return next;
      });
      setNotice({ tone: "success", text: `${removeStudentTarget.name} fue retirado de la sección ${selectedSection?.code}. Su registro personal se conserva desactivado.` });
      setRemoveStudentTarget(null);
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setRemovingStudent(false);
    }
  };

  const handleDownload = async (fileId) => {
    if (!fileId) return;
    setDownloadingFileId(fileId);
    try {
      await downloadProjectFile(project.id, fileId);
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setDownloadingFileId("");
    }
  };

  const handleAntecedentDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeletingFile(true);
    try {
      await deleteProjectFile(project.id, deleteTarget.id);
      setDeleteTarget(null);
      setNotice({ tone: "success", text: "El documento de antecedentes fue eliminado correctamente." });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setDeletingFile(false);
    }
  };

  const selectFile = (file, setter) => {
    if (!file) return false;
    const allowed = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "png", "jpg", "jpeg", "zip"];
    if (!allowed.includes(file.name.split(".").pop()?.toLowerCase())) {
      setNotice({ tone: "error", text: "El archivo debe ser PDF, Office, texto, imagen o ZIP." });
      return false;
    }
    if (file.size > 15 * 1024 * 1024) {
      setNotice({ tone: "error", text: "El archivo supera el máximo permitido de 15 MB." });
      return false;
    }
    setter(file);
    return true;
  };

  const requestAntecedentReplacement = (attachment) => {
    replaceTargetRef.current = attachment;
    replaceInputRef.current?.click();
  };

  const handleReplacementSelection = async (event) => {
    const target = replaceTargetRef.current;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!target || !selectFile(file, () => undefined)) {
      replaceTargetRef.current = null;
      return;
    }
    setReplacingFileId(target.id);
    try {
      await uploadProjectFile(project.id, "ANTECEDENTE", file, null, target.id);
      setNotice({ tone: "success", text: `${target.name} fue reemplazado correctamente por ${file.name}.` });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setReplacingFileId("");
      replaceTargetRef.current = null;
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      await closeProject(project.id, selectedSectionId);
      setNotice({ tone: "success", text: `La sección ${selectedSection?.code} quedó finalizada y su Hito 3 está completado.` });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setClosing(false);
    }
  };

  const handleScheduleMilestoneTwo = async (event) => {
    event.preventDefault();
    if (!scheduleDate) {
      setNotice({ tone: "error", text: "Selecciona la fecha desde la que estará disponible el Hito 2." });
      return;
    }
    setScheduling(true);
    try {
      await scheduleMilestoneTwo(project.id, scheduleDate);
      setNotice({ tone: "success", text: `El Hito 2 quedó programado desde el ${formatDate(scheduleDate)}.` });
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setScheduling(false);
    }
  };

  const handleReopenMilestone = async (event) => {
    event.preventDefault();
    if (!reopenTarget || reopenReason.trim().length < 10) {
      setNotice({ tone: "error", text: "Escribe un motivo de al menos 10 caracteres para dejar trazabilidad." });
      return;
    }
    setReopening(true);
    try {
      await reopenMilestone(project.id, reopenTarget.sectionId, reopenTarget.milestoneNumber, reopenReason.trim());
      const section = administrativeSections.find((item) => item.id === reopenTarget.sectionId);
      setNotice({ tone: "success", text: `El Hito ${reopenTarget.milestoneNumber} de la sección ${section?.code} quedó reabierto. Los hitos posteriores de esa sección también volvieron a pendiente.` });
      setReopenTarget(null);
      setReopenReason("");
    } catch (error) {
      setNotice({ tone: "error", text: error.message });
    } finally {
      setReopening(false);
    }
  };

  const openProjectEditor = () => {
    setProjectEditForm({
      partnerId: project.partnerId,
      name: project.name,
      description: project.description,
      expectedResult: project.expectedResult,
      subjectId: project.subjectId,
      campusIds: [...project.campusIds],
      sectionIds: [...project.sectionIds],
    });
    setProjectEditError("");
    setShowProjectEditor(true);
  };

  const updateProjectEditField = (field, value) => {
    setProjectEditForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "subjectId" ? { sectionIds: [] } : {}),
    }));
    setProjectEditError("");
  };

  const toggleProjectCampus = (campusId) => {
    setProjectEditForm((current) => {
      const campusIds = current.campusIds.includes(campusId)
        ? current.campusIds.filter((id) => id !== campusId)
        : [...current.campusIds, campusId];
      const validSectionIds = new Set(catalogs.sections
        .filter((section) => section.subjectId === current.subjectId && campusIds.includes(section.campusId))
        .map((section) => section.id));
      return { ...current, campusIds, sectionIds: current.sectionIds.filter((id) => validSectionIds.has(id)) };
    });
    setProjectEditError("");
  };

  const toggleProjectSection = (sectionId) => {
    setProjectEditForm((current) => ({
      ...current,
      sectionIds: current.sectionIds.includes(sectionId)
        ? current.sectionIds.filter((id) => id !== sectionId)
        : [...current.sectionIds, sectionId],
    }));
    setProjectEditError("");
  };

  const handleProjectEdit = async (event) => {
    event.preventDefault();
    const required = [projectEditForm.partnerId, projectEditForm.name, projectEditForm.description, projectEditForm.expectedResult, projectEditForm.subjectId];
    if (required.some((value) => !value.trim()) || !projectEditForm.campusIds.length || !projectEditForm.sectionIds.length) {
      setProjectEditError("Completa todos los campos y selecciona al menos una sede y una sección responsable.");
      return;
    }
    setSavingProjectEdit(true);
    try {
      await editProject(project.id, projectEditForm);
      setShowProjectEditor(false);
      setNotice({ tone: "success", text: "Los datos y las asignaciones del proyecto fueron actualizados correctamente." });
    } catch (error) {
      setProjectEditError(error.message);
    } finally {
      setSavingProjectEdit(false);
    }
  };

  const openProjectDeletion = () => {
    setProjectDeleteConfirmation("");
    setProjectDeleteError("");
    setProjectDeleteStep(1);
  };

  const closeProjectDeletion = () => {
    if (deletingProject) return;
    setProjectDeleteStep(0);
    setProjectDeleteConfirmation("");
    setProjectDeleteError("");
  };

  const handleProjectDeletion = async () => {
    if (projectDeleteConfirmation.trim() !== project.id) {
      setProjectDeleteError(`Escribe exactamente ${project.id} para confirmar.`);
      return;
    }
    setDeletingProject(true);
    setProjectDeleteError("");
    try {
      const result = await removeProject(project.id, projectDeleteConfirmation.trim());
      navigate("/app", {
        replace: true,
        state: {
          deletedProject: project.id,
          cleanupWarning: result.pendingFileCleanup
            ? `${result.pendingFileCleanup} archivo(s) quedaron pendientes de limpieza en el almacenamiento.`
            : "",
        },
      });
    } catch (error) {
      setProjectDeleteError(error.message);
      setDeletingProject(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={project.id}
        title={project.name}
        description={`Propuesta registrada en nombre de ${partner?.businessName || "socio formador"}.`}
        actions={<>{session.role === "admin" && <><Button variant="secondary" icon={Pencil} onClick={openProjectEditor}>Editar proyecto</Button><Button variant="danger" icon={Trash2} onClick={openProjectDeletion}>Eliminar proyecto</Button></>}<StatusBadge status={displayedProjectStatus} /><Link to="/app"><Button variant="secondary" icon={ArrowLeft}>Volver</Button></Link></>}
      />
      {notice && <div className={`notice-banner ${notice.tone === "success" ? "notice-banner--success" : notice.tone === "error" ? "notice-banner--error" : ""}`} role="status"><CheckCircle2 size={20} /><div><strong>Actualización del proyecto</strong><p>{notice.text}</p></div><button onClick={() => setNotice(null)}>×</button></div>}
      <div className="project-layout">
        <div className="project-main">
          <Card className="panel-card">
            <div className="card-heading"><div><p className="eyebrow">Antecedentes</p><h2>Descripción del proyecto</h2></div></div>
            <p className="project-description">{project.description}</p>
            <div className="expected-result"><Flag size={19} /><div><strong>Resultado esperado</strong><p>{project.expectedResult}</p></div></div>
            {projectAttachments.length ? (
              <div className="document-list">
                {projectAttachments.map((attachment) => (
                  <div key={attachment.id} className={`document-row document-row--antecedent${attachment.canDelete ? " can-delete" : ""}`}>
                    {attachment.canDelete && <button type="button" className="document-remove" aria-label={`Eliminar ${attachment.name}`} title="Eliminar archivo" disabled={deletingFile || Boolean(replacingFileId)} onClick={() => setDeleteTarget(attachment)}><X size={17} /></button>}
                    <span><FileText size={21} /></span>
                    <div><strong>{attachment.name}</strong><small>{formatFileSize(attachment.size)} · Documento de antecedentes</small></div>
                    <div className="document-actions">
                      <Button type="button" variant="secondary" icon={downloadingFileId === attachment.id ? LoaderCircle : Download} disabled={Boolean(downloadingFileId) || deletingFile || Boolean(replacingFileId)} onClick={() => handleDownload(attachment.id)}>{downloadingFileId === attachment.id ? "Descargando..." : "Descargar"}</Button>
                      {canManageAntecedents && <Button type="button" variant="secondary" icon={replacingFileId === attachment.id ? LoaderCircle : RefreshCw} disabled={uploadingFile || deletingFile || Boolean(replacingFileId)} onClick={() => requestAntecedentReplacement(attachment)}>{replacingFileId === attachment.id ? "Reemplazando..." : "Reemplazar"}</Button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="document-empty"><FileText size={19} /> Esta propuesta no tiene documentos adjuntos.</div>}
            <input ref={replaceInputRef} className="visually-hidden" type="file" tabIndex={-1} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip" onChange={handleReplacementSelection} />
            {canManageAntecedents && (
              <div className="document-upload">
                <label className="file-control"><Upload size={18} /><span>{antecedentFile?.name || "Seleccionar un nuevo documento"}</span><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip" onChange={(event) => selectFile(event.target.files?.[0], setAntecedentFile)} /></label>
                <Button type="button" variant="secondary" icon={uploadingFile ? LoaderCircle : Upload} disabled={!antecedentFile || uploadingFile || deletingFile || Boolean(replacingFileId)} onClick={handleAntecedentUpload}>{uploadingFile ? "Subiendo..." : projectAttachments.length ? "Adicionar archivo" : "Adjuntar archivo"}</Button>
              </div>
            )}
          </Card>

          {canAdministerMilestones && administrativeSections.some((section) => sectionMap.get(section.id)?.period === "2026-2") && (
            <PartnerReviewManager key={project.id} projectId={project.id} sections={administrativeSections.filter((section) => sectionMap.get(section.id)?.period === "2026-2")} />
          )}

          {canAdministerMilestones && (
            <MilestoneAdministration
              project={project}
              sections={administrativeSections}
              selectedSectionId={adminSectionId}
              scheduleDate={scheduleDate}
              scheduling={scheduling}
              reopenTarget={reopenTarget}
              reopenReason={reopenReason}
              reopening={reopening}
              onSelectSection={(sectionId) => { setAdminSectionId(sectionId); setReopenTarget(null); setReopenReason(""); }}
              onScheduleDate={setScheduleDate}
              onSchedule={handleScheduleMilestoneTwo}
              onRequestReopen={(milestoneNumber) => { setReopenTarget({ sectionId: adminSectionId, milestoneNumber }); setReopenReason(""); }}
              onReopenReason={setReopenReason}
              onCancelReopen={() => { setReopenTarget(null); setReopenReason(""); }}
              onReopen={handleReopenMilestone}
            />
          )}

          {canManageTeaching && (
            <SectionTabs
              sections={rosterSections}
              sectionStates={project.sectionStates || []}
              selectedSectionId={selectedSectionId}
              teachingStatus={project.teachingStatus}
              loading={loadingRoster}
              onSelectSection={setSelectedSectionId}
            />
          )}
          {canEditRoster && !loadingRoster && <RosterManagementBar section={selectedSection} onAdd={openStudentAdd} />}
          {canManageTeaching && !loadingRoster && selectedSection && !hito1Done && <TeamBuilder section={selectedSection} roster={selectedRoster} assignments={teamAssignments} saving={starting} onAssign={assignStudent} onStart={handleStart} onRemove={setRemoveStudentTarget} />}
          {canManageTeaching && !loadingRoster && selectedSection && hito1Done && !hito3Done && <StudentAssignmentEditor section={selectedSection} roster={selectedRoster} assignments={teamAssignments} savingStudentId={savingStudentId} onAssign={assignStudent} onSave={handleStudentAssignmentUpdate} onRemove={setRemoveStudentTarget} />}
          {canManageTeaching && !loadingRoster && selectedSection && hito1Done && !hito2Done && !hito2Available && <MilestoneWaiting project={project} section={selectedSection} />}
          {canManageTeaching && !loadingRoster && selectedSection && hito1Done && (hito2Available || hito2Done) && <HitoTwoPanel key={selectedSection.id} projectId={project.id} section={selectedSection} closed={hito2Done} progress={progress} setProgress={setProgress} saving={savingProgress} onSubmit={handleProgress} />}
          {canManageTeaching && selectedSection && hito2Done && (
            <DeliverablePanel
              section={selectedSection}
              progress={selectedSectionState?.progress}
              downloading={downloadingFileId}
              onDownload={handleDownload}
            />
          )}
          {canManageTeaching && hito2Done && !hito3Done && (
            <Card className="milestone-action milestone-action--close">
              <span><Flag size={24} /></span>
              <div><p className="eyebrow">Hito 3 · Sección {selectedSection?.code}</p><h2>Cierre de la sección</h2><p>Al declarar finalizada esta sección, su tercer hito se completará. El proyecto se cerrará cuando todas sus secciones terminen.</p></div>
              <Button variant="dark" icon={closing ? LoaderCircle : Check} disabled={closing} onClick={handleClose}>{closing ? "Cerrando..." : "Finalizar sección"}</Button>
            </Card>
          )}
          {canManageTeaching && selectedSection && hito3Done && <div className="completion-banner"><CheckCircle2 size={28} /><div><strong>Sección {selectedSection.code} finalizada</strong><p>Sus tres hitos están completos. Puedes revisar otra sección desde las pestañas.</p></div></div>}
        </div>

        <aside className="project-sidebar">
          <Card className="panel-card project-facts">
            <div className="card-heading"><div><p className="eyebrow">Vinculación</p><h2>Ficha académica</h2></div></div>
            <Fact icon={BookOpen} label="Asignatura" value={`${subject?.code} · ${subject?.name}`} />
            <Fact icon={MapPin} label="Sede" value={project.campusIds.map((id) => campusMap.get(id)?.name).filter(Boolean).join(", ")} />
            <Fact icon={School} label="Secciones responsables" value={project.sectionIds.map((id) => sectionMap.get(id)?.code).filter(Boolean).join(", ")} />
            <Fact icon={Building2} label="Socio formador" value={partner?.businessName} />
          </Card>
          <Card className="panel-card">
            <div className="card-heading"><div><p className="eyebrow">{session.role === "teacher" ? "Seguimiento propio" : "Seguimiento global"}</p><h2>{session.role === "teacher" ? "Hitos de mis secciones" : "Hitos del proyecto"}</h2></div></div>
            <ol className="milestone-list">
              {project.milestones.map((milestone) => (
                <li key={milestone.id} className={milestone.status === "Completado" ? "is-complete" : ""}>
                  <span>{milestone.status === "Completado" ? <Check size={16} /> : milestone.id}</span>
                  <div><strong>{milestone.name}</strong><small>{milestone.completedAt ? formatDate(milestone.completedAt) : "Pendiente"}</small></div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
      {showProjectEditor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!savingProjectEdit) setShowProjectEditor(false); }}>
          <section className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="edit-project-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="icon-button modal-close" aria-label="Cerrar edición" disabled={savingProjectEdit} onClick={() => setShowProjectEditor(false)}><X size={18} /></button>
            <span className="modal__icon"><Pencil size={21} /></span>
            <h2 id="edit-project-dialog-title">Editar proyecto {project.id}</h2>
            <p>Actualiza los antecedentes y las asignaciones académicas. Los cambios quedarán registrados en auditoría.</p>
            <form className="form-grid form-grid--two" onSubmit={handleProjectEdit}>
              <Field label="Nombre del proyecto" required className="field--full"><Input maxLength="220" value={projectEditForm.name} onChange={(event) => updateProjectEditField("name", event.target.value)} /></Field>
              <Field label="Socio formador" required className="field--full">
                <Select value={projectEditForm.partnerId} onChange={(event) => updateProjectEditField("partnerId", event.target.value)}>
                  <option value="">Seleccionar socio formador</option>
                  {partners.map((item) => <option key={item.id} value={item.id}>{item.businessName}</option>)}
                </Select>
              </Field>
              <Field label="Descripción" required className="field--full"><Textarea rows="5" maxLength="1200" value={projectEditForm.description} onChange={(event) => updateProjectEditField("description", event.target.value)} /></Field>
              <Field label="Resultado esperado" required className="field--full"><Textarea rows="3" value={projectEditForm.expectedResult} onChange={(event) => updateProjectEditField("expectedResult", event.target.value)} /></Field>
              <Field label="Asignatura" required className="field--full">
                <Select value={projectEditForm.subjectId} onChange={(event) => updateProjectEditField("subjectId", event.target.value)}>
                  <option value="">Seleccionar asignatura</option>
                  {catalogs.subjects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </Select>
              </Field>
              <Field label="Sedes asociadas" hint="Las secciones responsables deben pertenecer a estas sedes." required className="field--full">
                <div className="check-grid">
                  {catalogs.campuses.map((campus) => (
                    <label key={campus.id} className={`check-option ${projectEditForm.campusIds.includes(campus.id) ? "is-selected" : ""}`}>
                      <input type="checkbox" checked={projectEditForm.campusIds.includes(campus.id)} onChange={() => toggleProjectCampus(campus.id)} />
                      <span>{campus.name}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Secciones responsables" hint="Solo estas secciones generan hitos y forman parte del avance." required className="field--full">
                {availableEditSections.length ? (
                  <div className="check-grid">
                    {availableEditSections.map((section) => (
                      <label key={section.id} className={`check-option ${projectEditForm.sectionIds.includes(section.id) ? "is-selected" : ""}`}>
                        <input type="checkbox" checked={projectEditForm.sectionIds.includes(section.id)} onChange={() => toggleProjectSection(section.id)} />
                        <span>{campusMap.get(section.campusId)?.name || section.campus || "Sede"} · {section.code}{section.schedule || section.shift ? ` · ${section.schedule || section.shift}` : ""}</span>
                      </label>
                    ))}
                  </div>
                ) : <div className="selection-empty"><School size={18} /> Selecciona una asignatura y una sede con secciones activas.</div>}
              </Field>
              <div className="inline-callout field--full"><span><TriangleAlert size={18} /></span><p>Una sección con equipos, archivos, avances o hitos completados no puede retirarse. Sí puedes corregir los demás datos o agregar nuevas secciones.</p></div>
              {projectEditError && <div className="form-error field--full">{projectEditError}</div>}
              <div className="field--full form-actions"><Button type="button" variant="secondary" disabled={savingProjectEdit} onClick={() => setShowProjectEditor(false)}>Cancelar</Button><Button type="submit" icon={savingProjectEdit ? LoaderCircle : Save} disabled={savingProjectEdit}>{savingProjectEdit ? "Guardando..." : "Guardar cambios"}</Button></div>
            </form>
          </section>
        </div>
      )}
      {showStudentAdd && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!addingStudent) setShowStudentAdd(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-student-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="icon-button modal-close" aria-label="Cerrar" disabled={addingStudent} onClick={() => setShowStudentAdd(false)}><X size={18} /></button>
            <span className="modal__icon"><UserPlus size={22} /></span>
            <h2 id="add-student-dialog-title">Agregar alumno a la sección {selectedSection?.code}</h2>
            <p>Ingresa solamente su nombre y RUT. Si ya existe en el sistema, se reutilizará su registro y quedará inicialmente sin equipo.</p>
            <form className="form-grid" onSubmit={handleManualStudentAdd}>
              <Field label="Nombre completo" required>
                <Input autoFocus maxLength="180" value={manualStudent.name} disabled={addingStudent} placeholder="Nombre y apellidos" onChange={(event) => { setManualStudent({ ...manualStudent, name: event.target.value }); setManualStudentError(""); }} />
              </Field>
              <Field label="RUT" hint="Puedes escribirlo con o sin puntos y guion." required>
                <Input maxLength="15" value={manualStudent.rut} disabled={addingStudent} placeholder="12.345.678-5" onChange={(event) => { setManualStudent({ ...manualStudent, rut: event.target.value }); setManualStudentError(""); }} />
              </Field>
              {manualStudentError && <div className="form-error">{manualStudentError}</div>}
              <div className="form-actions"><Button type="button" variant="secondary" disabled={addingStudent} onClick={() => setShowStudentAdd(false)}>Cancelar</Button><Button type="submit" icon={addingStudent ? LoaderCircle : UserPlus} disabled={addingStudent}>{addingStudent ? "Agregando..." : "Agregar alumno"}</Button></div>
            </form>
          </section>
        </div>
      )}
      {removeStudentTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!removingStudent) setRemoveStudentTarget(null); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="remove-student-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal__icon modal__icon--danger"><UserMinus size={22} /></span>
            <h2 id="remove-student-dialog-title">Quitar alumno de la sección</h2>
            <p><strong>{removeStudentTarget.name}</strong> dejará de aparecer en la sección {selectedSection?.code} y será retirado de su equipo. Su registro personal no se eliminará y el Hito 1 no cambiará.</p>
            <div className="inline-callout"><span><TriangleAlert size={18} /></span><p>El cambio se reflejará en todos los proyectos que utilicen esta sección.</p></div>
            <div className="form-actions"><Button type="button" variant="secondary" disabled={removingStudent} onClick={() => setRemoveStudentTarget(null)}>Cancelar</Button><Button type="button" variant="danger" icon={removingStudent ? LoaderCircle : UserMinus} disabled={removingStudent} onClick={handleStudentRemoval}>{removingStudent ? "Quitando..." : "Quitar de la sección"}</Button></div>
          </section>
        </div>
      )}
      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!deletingFile) setDeleteTarget(null); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-file-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal__icon modal__icon--danger"><TriangleAlert size={22} /></span>
            <h2 id="delete-file-dialog-title">Eliminar documento</h2>
            <p>Se eliminará <strong>{deleteTarget.name}</strong> de esta propuesta. Los demás documentos permanecerán disponibles. Esta acción no se puede deshacer.</p>
            <div className="form-actions"><Button type="button" variant="secondary" disabled={deletingFile} onClick={() => setDeleteTarget(null)}>Cancelar</Button><Button type="button" variant="danger" icon={deletingFile ? LoaderCircle : Trash2} disabled={deletingFile} onClick={handleAntecedentDelete}>{deletingFile ? "Eliminando..." : "Eliminar definitivamente"}</Button></div>
          </section>
        </div>
      )}
      {projectDeleteStep === 1 && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeProjectDeletion}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-warning-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal__icon modal__icon--danger"><TriangleAlert size={22} /></span>
            <p className="eyebrow">Primera advertencia</p>
            <h2 id="delete-project-warning-title">¿Eliminar el proyecto {project.id}?</h2>
            <p>Se borrarán definitivamente el proyecto, sus secciones asociadas, equipos, asignaciones de estudiantes, avances, hitos y todos sus archivos. Esta acción no se puede deshacer.</p>
            <div className="form-actions"><Button type="button" variant="secondary" onClick={closeProjectDeletion}>Cancelar</Button><Button type="button" variant="danger" icon={TriangleAlert} onClick={() => setProjectDeleteStep(2)}>Entiendo, continuar</Button></div>
          </section>
        </div>
      )}
      {projectDeleteStep === 2 && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeProjectDeletion}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-project-confirmation-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal__icon modal__icon--danger"><Trash2 size={22} /></span>
            <p className="eyebrow">Segunda advertencia</p>
            <h2 id="delete-project-confirmation-title">Confirmar eliminación definitiva</h2>
            <p>Estás a punto de borrar <strong>{project.name}</strong>. Para confirmar, escribe el código <strong>{project.id}</strong>.</p>
            <Field label="Código del proyecto" required>
              <Input
                autoFocus
                autoComplete="off"
                value={projectDeleteConfirmation}
                disabled={deletingProject}
                placeholder={project.id}
                onChange={(event) => { setProjectDeleteConfirmation(event.target.value); setProjectDeleteError(""); }}
              />
            </Field>
            {projectDeleteError && <div className="form-error">{projectDeleteError}</div>}
            <div className="form-actions"><Button type="button" variant="secondary" disabled={deletingProject} onClick={closeProjectDeletion}>Cancelar</Button><Button type="button" variant="danger" icon={deletingProject ? LoaderCircle : Trash2} disabled={deletingProject || projectDeleteConfirmation.trim() !== project.id} onClick={handleProjectDeletion}>{deletingProject ? "Eliminando..." : "Eliminar definitivamente"}</Button></div>
          </section>
        </div>
      )}
    </>
  );
}

function MilestoneAdministration({
  project,
  sections,
  selectedSectionId,
  scheduleDate,
  scheduling,
  reopenTarget,
  reopenReason,
  reopening,
  onSelectSection,
  onScheduleDate,
  onSchedule,
  onRequestReopen,
  onReopenReason,
  onCancelReopen,
  onReopen,
}) {
  const milestoneOneComplete = project.milestones[0].status === "Completado";
  const completedHitoOneSections = project.sectionStates.filter((section) => section.milestones[0].status === "Completado").length;
  const milestoneTwoStarted = project.milestoneTwoStarted || project.sectionStates.some((section) => section.milestones[1].status === "Completado");
  const selectedState = project.sectionStates.find((section) => section.sectionId === selectedSectionId);
  const selectedSection = sections.find((section) => section.id === selectedSectionId);
  const completedMilestones = selectedState?.milestones.filter((milestone) => milestone.status === "Completado") || [];

  return (
    <Card id="control-hitos" className="panel-card milestone-admin">
      <div className="card-heading"><div><p className="eyebrow">Coordinación</p><h2>Control de hitos</h2><p>Programa la siguiente etapa o reabre una sección cuando necesite correcciones.</p></div></div>
      <div className="milestone-admin__grid">
        <section className="milestone-admin__section">
          <div className="milestone-admin__heading"><span><CalendarClock size={20} /></span><div><strong>Programar Hito 2</strong><small>{completedHitoOneSections}/{project.sectionStates.length} secciones completaron Hito 1</small></div></div>
          {!milestoneOneComplete && <p className="milestone-admin__message">La fecha podrá definirse cuando todas las secciones completen el Hito 1.</p>}
          {milestoneOneComplete && (
            <form className="milestone-schedule" onSubmit={onSchedule}>
              <Field label="Disponible desde">
                <Input type="date" min={todayInputDate()} value={scheduleDate} disabled={milestoneTwoStarted} onChange={(event) => onScheduleDate(event.target.value)} />
              </Field>
              <Button type="submit" icon={scheduling ? LoaderCircle : CalendarClock} disabled={scheduling || milestoneTwoStarted || !scheduleDate}>{scheduling ? "Programando..." : project.milestones[1].availableFrom ? "Actualizar fecha" : "Programar apertura"}</Button>
            </form>
          )}
          {project.milestones[1].availableFrom && <p className="milestone-admin__message milestone-admin__message--success">{project.milestones[1].available ? "Hito 2 disponible" : "Hito 2 programado"} desde el {formatDate(project.milestones[1].availableFrom)}.</p>}
          {milestoneTwoStarted && <p className="milestone-admin__message">La fecha quedó fija porque ya existen entregas de Hito 2.</p>}
        </section>

        <section className="milestone-admin__section">
          <div className="milestone-admin__heading"><span><RotateCcw size={20} /></span><div><strong>Reabrir para corrección</strong><small>La acción y su motivo quedarán auditados</small></div></div>
          <Field label="Sección">
            <select className="control" value={selectedSectionId} onChange={(event) => onSelectSection(event.target.value)}>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.code} · {section.campusName}</option>)}
            </select>
          </Field>
          <div className="milestone-reopen-actions">
            {completedMilestones.map((milestone) => <Button key={milestone.id} type="button" variant="secondary" icon={RotateCcw} onClick={() => onRequestReopen(milestone.id)}>Reabrir Hito {milestone.id}</Button>)}
            {!completedMilestones.length && <p className="milestone-admin__message">La sección seleccionada todavía no tiene hitos completados.</p>}
          </div>
          {reopenTarget && reopenTarget.sectionId === selectedSectionId && (
            <form className="milestone-reopen-confirm" onSubmit={onReopen}>
              <p><strong>Reabrir Hito {reopenTarget.milestoneNumber} · Sección {selectedSection?.code}</strong> Los hitos posteriores de esta sección también volverán a pendiente.</p>
              <Field label="Motivo de reapertura" required><Textarea rows="3" value={reopenReason} onChange={(event) => onReopenReason(event.target.value)} placeholder="Explica qué debe corregirse antes de completar nuevamente el hito..." /></Field>
              <div className="form-actions"><Button type="button" variant="secondary" onClick={onCancelReopen}>Cancelar</Button><Button type="submit" icon={reopening ? LoaderCircle : RotateCcw} disabled={reopening}>{reopening ? "Reabriendo..." : "Confirmar reapertura"}</Button></div>
            </form>
          )}
        </section>
      </div>
    </Card>
  );
}

function MilestoneWaiting({ project, section }) {
  const availableFrom = project.milestones[1].availableFrom;
  const allSectionsReady = project.milestones[0].status === "Completado";
  return (
    <Card className="milestone-waiting">
      <span><Clock3 size={24} /></span>
      <div>
        <p className="eyebrow">Hito 2 · Sección {section.code}</p>
        <h2>Esperando apertura de coordinación</h2>
        <p>{!allSectionsReady
          ? "Tu Hito 1 está completo. El Hito 2 se habilitará cuando todas las secciones terminen esta primera etapa y coordinación programe la fecha."
          : availableFrom
            ? `El Hito 2 podrá enviarse desde el ${formatDate(availableFrom)}.`
            : "Todas las secciones completaron el Hito 1. Coordinación debe programar la fecha de apertura del Hito 2."}</p>
      </div>
    </Card>
  );
}

function SectionTabs({ sections, sectionStates, selectedSectionId, teachingStatus, loading, onSelectSection }) {
  return (
    <Card className="panel-card">
      <div className="card-heading">
        <div><p className="eyebrow">Trabajo docente</p><h2>Avance por sección</h2><p>Selecciona una sección para completar y consultar sus hitos.</p></div>
        <div className="section-workspace-summary">
          {teachingStatus && <StatusBadge status={teachingStatus} />}
          <span className="record-count"><School size={15} /> {sections.length} secciones asignadas</span>
        </div>
      </div>
      {!loading && sections.length > 0 && (
        <div className="section-workspace-tabs" role="tablist" aria-label="Secciones asignadas al docente">
          {sections.map((section) => {
            const state = sectionStates.find((item) => item.sectionId === section.id);
            const status = getSectionStatus(state);
            return (
              <button key={section.id} type="button" role="tab" aria-selected={section.id === selectedSectionId} className={`section-workspace-tab ${section.id === selectedSectionId ? "is-active" : ""} ${status.complete ? "is-saved" : ""}`} onClick={() => onSelectSection(section.id)}>
                <span><strong>Sección {section.code}</strong><small>{section.campusName} · {section.students.length} estudiantes</small></span>
                <em>{status.complete && <Check size={13} />}{status.label}</em>
              </button>
            );
          })}
        </div>
      )}
      {loading && <p className="selection-empty"><LoaderCircle size={17} /> Cargando secciones desde Azure SQL...</p>}
      {!loading && sections.length === 0 && <p className="selection-empty">No hay estudiantes vigentes en tus secciones para este proyecto.</p>}
    </Card>
  );
}

function RosterManagementBar({ section, onAdd }) {
  return (
    <Card className="panel-card roster-management-bar">
      <div>
        <p className="eyebrow">Nómina de la sección {section.code}</p>
        <strong>Altas y retiros manuales</strong>
        <small>Los alumnos retirados dejan de mostrarse, pero su registro se conserva para auditoría.</small>
      </div>
      <Button type="button" variant="secondary" icon={UserPlus} onClick={onAdd}>Agregar alumno</Button>
    </Card>
  );
}

function TeamBuilder({ section, roster, assignments, saving, onAssign, onStart, onRemove }) {
  const assignedStudentCount = roster.filter((student) => TEAM_NUMBERS.includes(assignments[student.id])).length;
  const teamCount = new Set(roster.map((student) => assignments[student.id]).filter((value) => TEAM_NUMBERS.includes(value))).size;
  return (
    <Card className="panel-card">
      <div className="card-heading">
        <div><p className="eyebrow">Hito 1 · Sección {section.code}</p><h2>Formación de equipos</h2><p>Distribuye la nómina en hasta 20 grupos. Al guardarla completa, el Hito 1 quedará completado solamente para esta sección.</p></div>
        <div className="team-builder-summary">
          <span className="record-count"><Users size={15} /> {roster.length} estudiantes</span>
          <span className={`record-count team-count ${teamCount ? "is-active" : ""}`}>{teamCount} {teamCount === 1 ? "grupo por crear" : "grupos por crear"}</span>
        </div>
      </div>
      <div className="section-workspace-heading">
        <div><small>Nómina seleccionada</small><strong>Sección {section.code} · {section.campusName}</strong></div>
        <div className="team-assignment-progress"><strong>{assignedStudentCount}/{roster.length}</strong><small>asignados a equipos</small></div>
      </div>
      <div className="student-list">
        {roster.map((student) => (
          <div key={student.id} className="student-row student-row--manageable">
            <span className="avatar avatar--small">{student.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>
            <div><strong>{student.name}</strong><small>{student.rut}</small></div>
            <select className="control" value={assignments[student.id] || ""} onChange={(event) => onAssign(student.id, event.target.value)}>
              <option value="SIN_EQUIPO">Sin equipo</option>
              <option value="DESERTOR">Desertor</option>
              {TEAM_NUMBERS.map((number) => <option key={number} value={number}>Equipo {number}</option>)}
            </select>
            <Button type="button" variant="danger" icon={UserMinus} disabled={saving} onClick={() => onRemove(student)}>Quitar</Button>
          </div>
        ))}
        {!roster.length && <p className="selection-empty">Esta sección no tiene estudiantes vigentes. Puedes agregar uno manualmente.</p>}
      </div>
      <div className="form-actions"><Button icon={saving ? LoaderCircle : Users} disabled={saving || roster.length === 0} onClick={onStart}>{saving ? "Guardando equipos..." : "Guardar y completar Hito 1"}</Button></div>
    </Card>
  );
}

function StudentAssignmentEditor({ section, roster, assignments, savingStudentId, onAssign, onSave, onRemove }) {
  const assignedCount = roster.filter((student) => student.assignmentStatus === "ASIGNADO").length;
  const dropoutCount = roster.filter((student) => student.assignmentStatus === "DESERTOR").length;
  return (
    <Card className="panel-card student-assignment-editor">
      <div className="card-heading">
        <div><p className="eyebrow">Nómina editable · Sección {section.code}</p><h2>Estado de los estudiantes</h2><p>Cambia un equipo o registra a un estudiante sin equipo o desertor. Estas correcciones no modifican el Hito 1 ya completado.</p></div>
        <div className="team-builder-summary"><span className="record-count">{assignedCount} asignados</span><span className="record-count">{dropoutCount} desertores</span></div>
      </div>
      <div className="student-list">
        {roster.map((student) => {
          const savedValue = getStudentAssignmentValue(student);
          const selectedValue = assignments[student.id] || savedValue;
          const dirty = selectedValue !== savedValue;
          return (
            <div key={student.id} className="student-row student-row--editable student-row--manageable">
              <span className="avatar avatar--small">{student.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>
              <div><strong>{student.name}</strong><small>{student.rut} · {formatStudentAssignment(student)}</small></div>
              <select className="control" value={selectedValue} disabled={savingStudentId === student.id} onChange={(event) => onAssign(student.id, event.target.value)}>
                <option value="SIN_EQUIPO">Sin equipo</option>
                <option value="DESERTOR">Desertor</option>
                {TEAM_NUMBERS.map((number) => <option key={number} value={number}>Equipo {number}</option>)}
              </select>
              <Button type="button" variant="secondary" icon={savingStudentId === student.id ? LoaderCircle : Save} disabled={!dirty || Boolean(savingStudentId)} onClick={() => onSave(student)}>{savingStudentId === student.id ? "Guardando..." : "Guardar cambio"}</Button>
              <Button type="button" variant="danger" icon={UserMinus} disabled={Boolean(savingStudentId)} onClick={() => onRemove(student)}>Quitar</Button>
            </div>
          );
        })}
        {!roster.length && <p className="selection-empty">Esta sección no tiene estudiantes vigentes. Puedes agregar uno manualmente.</p>}
      </div>
    </Card>
  );
}

function DeliverablePanel({ section, progress, downloading, onDownload }) {
  const deliverableId = progress?.deliverableId || progress?.deliverable?.id;
  const deliverableName = progress?.deliverableName || progress?.deliverable?.name;
  if (!deliverableId || !deliverableName) return null;
  return (
    <Card className="panel-card deliverable-panel">
      <div className="card-heading"><div><p className="eyebrow">Hito 2 · Sección {section.code}</p><h2>Archivo histórico de la sección</h2><p>Documento adjuntado anteriormente, conservado sólo para consulta. Las nuevas entregas del Hito 2 corresponden a los videos de los equipos.</p></div></div>
      <div className="document-row"><span><FileText size={21} /></span><div><strong>{deliverableName}</strong><small>{formatFileSize(progress?.deliverable?.size)} · Archivo histórico Hito 2</small></div><Button type="button" variant="secondary" icon={downloading === deliverableId ? LoaderCircle : Download} disabled={Boolean(downloading)} onClick={() => onDownload(deliverableId)}>{downloading === deliverableId ? "Descargando..." : "Descargar"}</Button></div>
    </Card>
  );
}

function getSectionStatus(state) {
  if (state?.milestones?.[2]?.status === "Completado") return { label: "Finalizada", complete: true };
  if (state?.milestones?.[1]?.status === "Completado") return { label: "Hito 2 completo", complete: true };
  if (state?.milestones?.[0]?.status === "Completado") return { label: "Hito 1 completo", complete: true };
  return { label: "Hito 1 pendiente", complete: false };
}

function Fact({ icon: Icon, label, value }) {
  return <div className="fact-row"><span><Icon size={18} /></span><div><small>{label}</small><strong>{value || "Sin información"}</strong></div></div>;
}

function getStudentAssignmentValue(student) {
  if (student?.assignmentStatus === "DESERTOR") return "DESERTOR";
  if (student?.assignmentStatus === "SIN_EQUIPO" || !student?.teamName) return "SIN_EQUIPO";
  const teamNumber = student.teamName.match(/^Equipo\s+(20|1[0-9]|[1-9])$/i)?.[1];
  return teamNumber || "SIN_EQUIPO";
}

function formatStudentAssignment(student) {
  if (student?.assignmentStatus === "DESERTOR") return "Desertor";
  if (student?.assignmentStatus === "ASIGNADO" && student.teamName) return `Asignado a ${student.teamName}`;
  return "Sin equipo";
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "Tamaño no informado";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function todayInputDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
