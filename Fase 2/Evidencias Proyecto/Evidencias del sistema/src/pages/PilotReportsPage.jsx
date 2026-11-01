import {
  BarChart3, BookOpen, CheckCircle2, CircleAlert, ClipboardCheck,
  Download, FileClock, GraduationCap, LoaderCircle, School, Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, MetricCard, PageHeader, SearchInput } from "../components/UI";
import { downloadCsv, getAuditEvents, getPilotOverview, getPilotReport } from "../services/reportingApi";
import { formatAuditAction } from "../utils/auditLabels";

const REPORTS = {
  campuses: {
    label: "Por sede",
    description: "Oferta, participantes y proyectos de cada sede.",
    columns: [
      { key: "code", label: "Código" }, { key: "name", label: "Sede" },
      { key: "subjects", label: "Asignaturas" }, { key: "sections", label: "Secciones" },
      { key: "teachers", label: "Docentes" }, { key: "students", label: "Estudiantes" },
      { key: "projects", label: "Proyectos" },
    ],
  },
  subjects: {
    label: "Por asignatura",
    description: "Cobertura académica y proyectos vinculados por asignatura.",
    columns: [
      { key: "code", label: "Código" }, { key: "name", label: "Asignatura" },
      { key: "campuses", label: "Sedes" }, { key: "sections", label: "Secciones" },
      { key: "teachers", label: "Docentes" }, { key: "students", label: "Estudiantes" },
      { key: "projects", label: "Proyectos" },
    ],
  },
  sections: {
    label: "Por sección",
    description: "Detalle operativo independiente para cada sección.",
    columns: [
      { key: "period", label: "Período" }, { key: "subjectCode", label: "Código asignatura" },
      { key: "subjectName", label: "Asignatura" }, { key: "campusName", label: "Sede" },
      { key: "sectionCode", label: "Sección" }, { key: "shift", label: "Jornada" },
      { key: "teachers", label: "Docentes" }, { key: "students", label: "Estudiantes" },
      { key: "projects", label: "Proyectos" }, { key: "teams", label: "Equipos" },
    ],
  },
};

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function PilotReportsPage() {
  const [tab, setTab] = useState("readiness");
  const [overview, setOverview] = useState(null);
  const [reportKey, setReportKey] = useState("campuses");
  const [report, setReport] = useState(null);
  const [audit, setAudit] = useState({ records: [], total: 0, page: 1, pageSize: 25 });
  const [auditQuery, setAuditQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getPilotOverview().then(setOverview).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== "reports") return;
    setLoading(true);
    setError("");
    getPilotReport(reportKey).then(setReport).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [tab, reportKey]);

  const loadAudit = useCallback((page = 1) => {
    setLoading(true);
    setError("");
    getAuditEvents(auditQuery, page).then(setAudit).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [auditQuery]);

  useEffect(() => { if (tab === "audit") loadAudit(1); }, [tab, loadAudit]);

  const readyCount = overview?.readiness.filter((item) => item.ready).length || 0;
  const currentReport = REPORTS[reportKey];
  const auditPages = Math.max(1, Math.ceil(audit.total / audit.pageSize));
  const readinessPercent = overview ? Math.round((readyCount / overview.readiness.length) * 100) : 0;
  const reportFilename = useMemo(() => `vcm-2026-${reportKey}-${new Date().toISOString().slice(0, 10)}.csv`, [reportKey]);

  return (
    <>
      <PageHeader eyebrow="Control del piloto" title="Reportes y preparación"
        description="Supervisa la cobertura académica, exporta información operativa y revisa quién realizó cada cambio sensible." />

      <div className="page-tabs" role="tablist" aria-label="Reportes del piloto">
        <button type="button" role="tab" aria-selected={tab === "readiness"} className={tab === "readiness" ? "is-active" : ""} onClick={() => setTab("readiness")}><ClipboardCheck size={17} /> Estado del piloto</button>
        <button type="button" role="tab" aria-selected={tab === "reports"} className={tab === "reports" ? "is-active" : ""} onClick={() => setTab("reports")}><BarChart3 size={17} /> Reportes</button>
        <button type="button" role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "is-active" : ""} onClick={() => setTab("audit")}><FileClock size={17} /> Auditoría</button>
      </div>

      {error && <div className="notice-banner notice-banner--error"><CircleAlert size={20} /><div><strong>No fue posible cargar esta vista</strong><p>{error}</p></div></div>}
      {loading && !overview ? <Card className="report-loading"><LoaderCircle size={22} /> Consultando vcm_piloto_2026_local...</Card> : null}

      {tab === "readiness" && overview && <ReadinessView overview={overview} readyCount={readyCount} readinessPercent={readinessPercent} />}
      {tab === "reports" && <ReportsView reportKey={reportKey} setReportKey={setReportKey} report={report} currentReport={currentReport} loading={loading} onExport={() => downloadCsv(reportFilename, currentReport.columns, report?.records || [])} />}
      {tab === "audit" && <AuditView audit={audit} query={auditQuery} setQuery={setAuditQuery} onSearch={() => loadAudit(1)} loading={loading} pages={auditPages} onPage={loadAudit} />}
    </>
  );
}

function ReadinessView({ overview, readyCount, readinessPercent }) {
  const { metrics } = overview;
  return <>
    <div className="metrics-grid">
      <MetricCard icon={School} label="Sedes y secciones" value={`${metrics.campuses} / ${metrics.sections}`} detail="Oferta activa" />
      <MetricCard icon={GraduationCap} label="Estudiantes" value={metrics.students} detail="Nómina activa" tone="blue" />
      <MetricCard icon={Users} label="Docentes vinculados" value={`${metrics.linkedTeachers}/${metrics.teachers}`} detail="Con cuenta de acceso" tone="green" />
      <MetricCard icon={BookOpen} label="Proyectos" value={metrics.projects} detail={`${metrics.activeProjects} en ejecución`} tone="purple" />
    </div>
    <Card className="panel-card readiness-overview">
      <div className="card-heading"><div><p className="eyebrow">Lista de control</p><h2>Preparación para operar</h2></div><span className="readiness-score">{readinessPercent}% · {readyCount}/{overview.readiness.length}</span></div>
      <div className="readiness-progress"><span style={{ width: `${readinessPercent}%` }} /></div>
      <div className="readiness-list">
        {overview.readiness.map((item) => <div className="readiness-item" key={item.key}><span className={item.ready ? "is-done" : ""}>{item.ready ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{item.ready ? "Listo" : "Pendiente"}</b></div>)}
      </div>
      <p className="report-footnote">Última carga: {formatDate(metrics.lastAcademicLoadAt)} · {metrics.lastAcademicLoadFile || "sin archivo"}</p>
    </Card>
  </>;
}

function ReportsView({ reportKey, setReportKey, report, currentReport, loading, onExport }) {
  return <>
    <div className="report-selector">
      {Object.entries(REPORTS).map(([key, definition]) => <button key={key} type="button" className={reportKey === key ? "is-active" : ""} onClick={() => setReportKey(key)}><BarChart3 size={19} /><span><strong>{definition.label}</strong><small>{definition.description}</small></span></button>)}
    </div>
    <Card className="panel-card table-card">
      <div className="card-heading"><div><p className="eyebrow">Consolidado</p><h2>{currentReport.label}</h2></div><Button variant="secondary" icon={Download} disabled={!report?.records.length} onClick={onExport}>Exportar CSV</Button></div>
      <div className="responsive-table report-table"><table><thead><tr>{currentReport.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>
        {report?.records.map((record, index) => <tr key={`${reportKey}-${index}`}>{currentReport.columns.map((column) => <td key={column.key}>{record[column.key] ?? "—"}</td>)}</tr>)}
        {!loading && !report?.records.length && <tr><td colSpan={currentReport.columns.length}>No hay registros disponibles.</td></tr>}
      </tbody></table></div>
    </Card>
  </>;
}

function AuditView({ audit, query, setQuery, onSearch, loading, pages, onPage }) {
  return <Card className="panel-card table-card">
    <div className="card-heading"><div><p className="eyebrow">Trazabilidad</p><h2>Bitácora administrativa</h2></div><span className="record-count">{audit.total} eventos</span></div>
    {audit.enabled === false && <div className="notice-banner"><CircleAlert size={20} /><div><strong>Auditoría pendiente de habilitar</strong><p>Ejecuta la migración 005_audit_and_reporting.sql en vcm_piloto_2026_local para comenzar a registrar cambios.</p></div></div>}
    <div className="toolbar"><SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuario, acción o entidad" /><Button variant="secondary" onClick={onSearch}>Buscar</Button></div>
    <div className="responsive-table report-table"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>
      {audit.records.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{event.actorEmail}</td><td><strong>{formatAuditAction(event.action)}</strong></td><td>{event.entity}<small>{event.entityId || ""}</small></td><td>{event.description}</td></tr>)}
      {!loading && !audit.records.length && <tr><td colSpan="5">Aún no existen eventos de auditoría.</td></tr>}
    </tbody></table></div>
    <div className="academic-pagination"><Button variant="ghost" disabled={audit.page <= 1 || loading} onClick={() => onPage(audit.page - 1)}>Anterior</Button><span>Página {audit.page} de {pages}</span><Button variant="ghost" disabled={audit.page >= pages || loading} onClick={() => onPage(audit.page + 1)}>Siguiente</Button></div>
  </Card>;
}
