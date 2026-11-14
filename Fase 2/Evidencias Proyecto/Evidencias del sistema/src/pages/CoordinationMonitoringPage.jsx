import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  LoaderCircle,
  RefreshCw,
  School,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, PageHeader, SearchInput, Select } from "../components/UI";
import MonitoringIndicators from "../components/MonitoringIndicators";
import MonitoringCampusCharts from "../components/MonitoringCampusCharts";
import { downloadCoordinationMonitoring, getCoordinationMonitoring } from "../services/coreApi";

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "attention", label: "Requieren atención" },
  { id: "ready", label: "Listos para avanzar" },
  { id: "finished", label: "Finalizados" },
];

export default function CoordinationMonitoringPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [campus, setCampus] = useState("all");
  const [period, setPeriod] = useState("");
  const [expandedProjects, setExpandedProjects] = useState([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState("");
  const [exportMessage, setExportMessage] = useState(null);
  const [alertsVisible, setAlertsVisible] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const exportMenuRef = useRef(null);
  const querySearch = search.trim();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setExportMenuOpen(false);
    const timer = setTimeout(async () => {
      try {
        const next = await getCoordinationMonitoring({ scope, campus, search: querySearch, period }, { signal: controller.signal });
        if (!controller.signal.aborted) setReport(next);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError.message || "No fue posible cargar el seguimiento.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, querySearch ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [campus, period, scope, querySearch, refreshKey]);

  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const closeOnPointer = (event) => {
      if (!exportMenuRef.current?.contains(event.target)) setExportMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setExportMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);

  const campuses = report?.availableCampuses || [];
  const periods = report?.availablePeriods || [];
  const matchesSelection = report?.filters?.scope === scope && report.filters.campus === campus
    && report.filters.search === querySearch && (report.filters.period || "") === period;
  const currentReport = matchesSelection ? report : null;
  const filteredProjects = currentReport?.projects || [];

  const toggleProject = (projectId) => setExpandedProjects((current) => current.includes(projectId)
    ? current.filter((id) => id !== projectId)
    : [...current, projectId]);

  const handleExport = async (mode) => {
    if (mode === "filtered" && (!currentReport || loading)) return;
    setExportMenuOpen(false);
    setExporting(mode);
    setExportMessage(null);
    try {
      const filename = await downloadCoordinationMonitoring(mode === "filtered" ? currentReport.filters : {});
      setExportMessage({ tone: "success", text: `${filename} se descargó correctamente.` });
    } catch (exportError) {
      setExportMessage({ tone: "error", text: exportError.message || "No fue posible generar el archivo Excel." });
    } finally {
      setExporting("");
    }
  };

  if (loading && !report) return <div className="session-loader" role="status">Cargando seguimiento...</div>;

  return (
    <>
      <PageHeader
        eyebrow="Coordinación CITT"
        title="Seguimiento del piloto"
        description="Controla el avance por proyecto, sede, sección y docente, y actúa cuando una etapa esté lista o necesite atención."
        actions={<>
          <div className="monitoring-export" ref={exportMenuRef}>
            <Button icon={exporting ? LoaderCircle : Download} disabled={Boolean(exporting) || loading || !currentReport} aria-expanded={exportMenuOpen} aria-haspopup="menu" aria-controls="monitoring-export-menu" onClick={() => setExportMenuOpen((open) => !open)}>{exporting ? "Generando..." : "Descargar Excel"}</Button>
            {exportMenuOpen && (
              <div id="monitoring-export-menu" className="monitoring-export__menu" role="menu">
                <button type="button" role="menuitem" disabled={loading || !currentReport || !filteredProjects.length} onClick={() => handleExport("filtered")}><strong>Vista filtrada</strong><small>{filteredProjects.length} proyectos según los filtros actuales</small></button>
                <button type="button" role="menuitem" onClick={() => handleExport("complete")}><strong>Portafolio completo</strong><small>Todos los proyectos, secciones, docentes y alumnos</small></button>
              </div>
            )}
          </div>
          <Button variant="secondary" icon={loading ? LoaderCircle : RefreshCw} disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>{loading ? "Actualizando..." : "Actualizar"}</Button>
        </>}
      />

      {error && <div className="notice-banner notice-banner--error" role="alert"><AlertTriangle size={20} /><div><strong>Seguimiento no disponible</strong><p>{error}</p></div></div>}
      {exportMessage && <div className={`notice-banner notice-banner--${exportMessage.tone}`} role="status"><Download size={20} /><div><strong>Exportación del seguimiento</strong><p>{exportMessage.text}</p></div><button onClick={() => setExportMessage(null)}>×</button></div>}

      <section className="monitoring-filter-panel" aria-labelledby="monitoring-filters-title">
        <div className="monitoring-toolbar">
          <div><h2 id="monitoring-filters-title">Filtrar seguimiento</h2><p>La selección actualiza los indicadores, los gráficos, las alertas y los proyectos.</p></div>
          <div className="monitoring-toolbar__controls">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value.slice(0, 150))} placeholder="Proyecto, sección o docente" />
            <Select value={campus} onChange={(event) => setCampus(event.target.value)} aria-label="Filtrar por sede">
              <option value="all">Todas las sedes</option>
              {campuses.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
            <Select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Filtrar por período académico">
              <option value="">Todos los períodos</option>
              {periods.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </div>
        </div>
        <div className="monitoring-segments" role="tablist" aria-label="Estado del seguimiento">
          {FILTERS.map((filter) => (
            <button key={filter.id} type="button" role="tab" aria-selected={scope === filter.id} className={scope === filter.id ? "is-active" : ""} onClick={() => setScope(filter.id)}>{filter.label}</button>
          ))}
        </div>
      </section>

      {!currentReport && !error && <div className="monitoring-selection-loading" role="status">Actualizando seguimiento para la selección…</div>}
      {currentReport && (
        <>
          <MonitoringIndicators indicators={currentReport.indicators} filters={currentReport.filters} generatedAt={currentReport.generatedAt} loading={loading} stale={Boolean(error)} />

          <MonitoringCampusCharts campuses={currentReport.campusComparisons} loading={loading} stale={Boolean(error)} />

          <MonitoringAlerts alerts={currentReport.alerts} projects={currentReport.projects} expanded={alertsVisible} onToggle={() => setAlertsVisible((visible) => !visible)} />

          <section className="monitoring-workspace" aria-labelledby="monitoring-projects-title">
            <div className="monitoring-toolbar">
              <div>
                <p className="eyebrow">Portafolio 2026</p>
                <h2 id="monitoring-projects-title">Avance por proyecto</h2>
              </div>
              <span className="monitoring-project-count">{filteredProjects.length} proyectos en esta selección</span>
            </div>

            <div className="monitoring-project-list">
              {filteredProjects.map((project) => (
                <MonitoringProject key={project.id} project={project} expanded={expandedProjects.includes(project.id)} onToggle={() => toggleProject(project.id)} />
              ))}
            </div>
            {!filteredProjects.length && <EmptyState title="No hay proyectos para estos filtros" description="Cambia los filtros o prueba otro término de búsqueda." />}
          </section>
        </>
      )}
    </>
  );
}

function MonitoringAlerts({ alerts, projects, expanded, onToggle }) {
  return (
    <section className="monitoring-alerts" aria-labelledby="monitoring-alerts-title">
      <div className="monitoring-alerts__heading">
        <div><p className="eyebrow">Atención</p><h2 id="monitoring-alerts-title">Alertas de seguimiento</h2></div>
        <div className="monitoring-alerts__controls"><span aria-label={`${alerts.length} alertas`}>{alerts.length}</span>
          <Button variant="secondary" icon={expanded ? ChevronDown : ChevronRight} aria-expanded={expanded} aria-controls="monitoring-alerts-content" onClick={onToggle}>{expanded ? "Ocultar alertas" : "Mostrar alertas"}</Button>
        </div>
      </div>
      <div id="monitoring-alerts-content" hidden={!expanded}>
      {expanded && (!alerts.length ? <div className="monitoring-alerts__empty"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>Sin alertas operativas</strong><p>No hay alertas pendientes para esta selección.</p></div></div> : <div className="monitoring-alert-list">
        {alerts.map((alert) => {
          const project = projects.find((item) => item.id === alert.projectId);
          const targetSection = alert.type === "OVERDUE_SECTIONS"
            ? project?.sections.find((section) => section.overdue)?.id
            : project?.sections.find((section) => section.needsAttention)?.id;
          const url = `/app/proyectos/${alert.projectId}${targetSection ? `?section=${targetSection}` : ""}#control-hitos`;
          return (
            <article key={alert.id} className={`monitoring-alert monitoring-alert--${alert.priority}`}>
              <span>{alert.priority === "high" ? <AlertTriangle size={18} /> : alert.priority === "medium" ? <CircleAlert size={18} /> : <CalendarClock size={18} />}</span>
              <div><strong>{alert.title}</strong><p>{alert.message}</p></div>
              <Link className="table-action" to={url}>Revisar <ChevronRight size={15} /></Link>
            </article>
          );
        })}
      </div>)}
      </div>
    </section>
  );
}

function MonitoringProject({ project, expanded, onToggle }) {
  const progressLabel = project.progressPercent === 100 ? "Completado" : `${project.progressPercent}% completado`;
  return (
    <article className={`monitoring-project ${expanded ? "is-expanded" : ""}`}>
      <header className="monitoring-project__header">
        <button type="button" className="monitoring-expand" onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Ocultar" : "Mostrar"} secciones de ${project.name}`} title={`${expanded ? "Ocultar" : "Mostrar"} secciones`}>
          {expanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}
        </button>
        <div className="monitoring-project__identity">
          <span>{project.id}</span>
          <strong>{project.name}</strong>
          <small>{project.subjectCode} · {project.subjectName}</small>
        </div>
        <div className="monitoring-project__progress">
          <div><span>{progressLabel}</span><small>{project.completedByMilestone[2]}/{project.sectionCount} secciones cerradas</small></div>
          <div className="monitoring-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={project.progressPercent}><span style={{ width: `${project.progressPercent}%` }} /></div>
        </div>
        <div className="monitoring-project__signals">
          {project.overdueSections > 0 && <span className="monitoring-signal monitoring-signal--danger">{project.overdueSections} atrasadas</span>}
          {project.readyForMilestoneTwo && <span className="monitoring-signal monitoring-signal--ready">Programar Hito 2</span>}
          {project.readyForClosure && <span className="monitoring-signal monitoring-signal--ready">Listo para cierre</span>}
          {!project.overdueSections && !project.readyForMilestoneTwo && !project.readyForClosure && <span className="monitoring-signal">{project.pendingSections ? `${project.pendingSections} pendientes` : "Finalizado"}</span>}
        </div>
        <Link className="monitoring-project__action" to={`/app/proyectos/${project.id}#control-hitos`} aria-label={`Revisar ${project.name}`} title="Revisar proyecto"><Eye size={18} /></Link>
      </header>

      {expanded && (
        <div className="monitoring-project__details">
          <div className="monitoring-project__meta">
            <span><School size={15} /> {project.campuses.join(", ")}</span>
            <span><Users size={15} /> {project.completedTeachers}/{project.teacherCount} seguimientos docentes cerrados</span>
            <span><CalendarClock size={15} /> {project.availableFrom ? `Hito 2 desde ${formatDate(project.availableFrom)}` : "Hito 2 sin programar"}</span>
          </div>
          <div className="responsive-table monitoring-section-table">
            <table>
              <thead><tr><th>Sección y sede</th><th>Docente</th><th>Estudiantes</th><th>Hitos</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {project.sections.map((section) => (
                  <tr key={section.id} className={section.needsAttention ? "needs-attention" : ""}>
                    <td><strong>{section.code}</strong><small>{section.campusName}{section.shift ? ` · ${section.shift}` : ""}</small></td>
                    <td>{section.teachers.length ? section.teachers.map((teacher) => <span className="monitoring-teacher" key={teacher.id}>{teacher.name}{!teacher.accountLinked && <small>Sin cuenta vinculada</small>}</span>) : <span className="monitoring-missing">Sin docente asignado</span>}</td>
                    <td><strong>{section.assignedStudentCount}/{section.studentCount}</strong><small>{section.teamCount} equipos</small></td>
                    <td><MilestoneTrack milestones={section.milestones} /></td>
                    <td><span className={`monitoring-section-status ${section.overdue ? "is-overdue" : section.completedMilestones === 3 ? "is-complete" : ""}`}>{section.overdue ? "Atrasada" : section.status}</span></td>
                    <td><Link className="table-action" to={`/app/proyectos/${project.id}?section=${section.id}#control-hitos`}>Revisar <ChevronRight size={15} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  );
}

function MilestoneTrack({ milestones }) {
  return (
    <div className="monitoring-milestones" aria-label={`${milestones.filter((milestone) => milestone.status === "Completado").length} de 3 hitos completados`}>
      {milestones.map((milestone) => <span key={milestone.number} className={milestone.status === "Completado" ? "is-complete" : ""} title={`Hito ${milestone.number}: ${milestone.status}`}>{milestone.status === "Completado" ? <CheckCircle2 size={14} /> : milestone.number}</span>)}
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
