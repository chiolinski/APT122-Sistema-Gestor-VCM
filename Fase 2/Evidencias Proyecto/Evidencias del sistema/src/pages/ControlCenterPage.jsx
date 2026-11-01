import {
  Activity, AlertTriangle, CheckCircle2, CircleAlert, DatabaseZap, FileClock,
  Filter, GraduationCap, LoaderCircle, RefreshCw, ShieldCheck, Users, Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, EmptyState, MetricCard, PageHeader, SearchInput, Select } from "../components/UI";
import { getControlAudit, getDataQuality } from "../services/controlCenterApi";
import { formatAuditAction, sortAuditActions } from "../utils/auditLabels";
import { useApp } from "../context/AppContext";
import BulkPartnerReviewClosure from "../components/BulkPartnerReviewClosure";

const SEVERITY_LABELS = { high: "Prioritaria", medium: "Revisar", info: "Informativa" };
const ROLE_LABELS = { admin: "Administrador", coordinator: "Coordinación", teacher: "Docente", system: "Sistema" };

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ControlCenterPage() {
  const { session } = useApp();
  const [tab, setTab] = useState("quality");
  const [quality, setQuality] = useState(null);
  const [audit, setAudit] = useState({ records: [], total: 0, page: 1, pageSize: 25, facets: { actions: [], entities: [] } });
  const [qualitySearch, setQualitySearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [auditFilters, setAuditFilters] = useState({ query: "", action: "all", entity: "all" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadQuality = useCallback(() => {
    setLoading(true);
    setError("");
    getDataQuality().then(setQuality).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const loadAudit = useCallback((page = 1, filters = auditFilters) => {
    setLoading(true);
    setError("");
    getControlAudit({ ...filters, page }).then(setAudit).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, [auditFilters]);

  useEffect(() => { loadQuality(); }, [loadQuality]);
  useEffect(() => { if (tab === "audit" && !audit.records.length) loadAudit(1); }, [audit.records.length, loadAudit, tab]);

  const filteredIssues = useMemo(() => {
    const term = qualitySearch.trim().toLocaleLowerCase("es");
    return (quality?.issues || []).filter((issue) => {
      if (severity !== "all" && issue.severity !== severity) return false;
      if (!term) return true;
      return `${issue.title} ${issue.description} ${issue.recommendation}`.toLocaleLowerCase("es").includes(term);
    });
  }, [quality, qualitySearch, severity]);
  const auditPages = Math.max(1, Math.ceil(audit.total / audit.pageSize));

  const refresh = () => tab === "quality" ? loadQuality() : loadAudit(audit.page);
  const submitAuditFilters = (event) => { event.preventDefault(); loadAudit(1); };

  return (
    <>
      <PageHeader eyebrow="Gobernanza operativa" title="Centro de control"
        description="Detecta inconsistencias en los datos y revisa la trazabilidad de las acciones realizadas durante el piloto."
        actions={tab !== "tools" && <Button variant="secondary" icon={loading ? LoaderCircle : RefreshCw} onClick={refresh} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</Button>} />

      <div className="page-tabs control-tabs" role="tablist" aria-label="Centro de control">
        <button type="button" role="tab" aria-selected={tab === "quality"} className={tab === "quality" ? "is-active" : ""} onClick={() => setTab("quality")}><DatabaseZap size={17} /> Calidad de datos</button>
        <button type="button" role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "is-active" : ""} onClick={() => setTab("audit")}><FileClock size={17} /> Auditoría</button>
        {session?.role === "admin" && <button type="button" role="tab" aria-selected={tab === "tools"} className={tab === "tools" ? "is-active" : ""} onClick={() => setTab("tools")}><Wrench size={17} /> Herramientas</button>}
      </div>

      {error && tab !== "tools" && <div className="notice-banner notice-banner--error" role="alert"><CircleAlert size={20} /><div><strong>No fue posible cargar esta vista</strong><p>{error}</p></div></div>}
      {tab === "quality" && <QualityView quality={quality} issues={filteredIssues} search={qualitySearch} setSearch={setQualitySearch} severity={severity} setSeverity={setSeverity} loading={loading} />}
      {tab === "audit" && <AuditView audit={audit} filters={auditFilters} setFilters={setAuditFilters} onSubmit={submitAuditFilters} loading={loading} pages={auditPages} onPage={(page) => loadAudit(page)} />}
      {tab === "tools" && session?.role === "admin" && <BulkPartnerReviewClosure />}
    </>
  );
}

function QualityView({ quality, issues, search, setSearch, severity, setSeverity, loading }) {
  const navigate = useNavigate();
  if (!quality && loading) return <Card className="control-loading"><LoaderCircle size={22} /> Analizando consistencia de los datos...</Card>;
  if (!quality) return null;
  return <>
    <div className="metrics-grid control-metrics">
      <MetricCard icon={ShieldCheck} label="Observaciones" value={quality.summary.total} detail={quality.summary.total ? "Requieren revisión" : "Datos consistentes"} />
      <MetricCard icon={AlertTriangle} label="Prioritarias" value={quality.summary.high} detail="Bloqueos potenciales" tone="blue" />
      <MetricCard icon={GraduationCap} label="Docentes" value={quality.summary.teachers} detail="Cuentas o cargas" tone="green" />
      <MetricCard icon={Activity} label="Secciones" value={quality.summary.sections} detail="Nómina o equipos" tone="purple" />
    </div>

    {quality.status === "healthy" && <div className="quality-healthy"><CheckCircle2 size={23} /><div><strong>Los datos operativos están consistentes</strong><p>No detectamos problemas de vinculación, secciones vacías ni equipos incompatibles.</p></div></div>}

    <section className="control-workspace" aria-labelledby="quality-title">
      <div className="control-workspace__heading"><div><p className="eyebrow">Validación automática</p><h2 id="quality-title">Observaciones detectadas</h2></div><span>{issues.length} visibles</span></div>
      <div className="control-filterbar">
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Docente, sección o proyecto" />
        <Select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filtrar por prioridad">
          <option value="all">Todas las prioridades</option><option value="high">Prioritarias</option><option value="medium">Por revisar</option><option value="info">Informativas</option>
        </Select>
      </div>
      <div className="quality-issue-list">
        {issues.map((issue) => <article className={`quality-issue quality-issue--${issue.severity}`} key={issue.id}>
          <span className="quality-issue__icon">{issue.severity === "high" ? <AlertTriangle size={19} /> : issue.severity === "medium" ? <CircleAlert size={19} /> : <Filter size={19} />}</span>
          <div className="quality-issue__copy"><div><span>{SEVERITY_LABELS[issue.severity]}</span><strong>{issue.title}</strong></div><p>{issue.description}</p><small>{issue.recommendation}</small></div>
          {issue.actionUrl && <Button variant="ghost" onClick={() => navigate(issue.actionUrl)}>Revisar</Button>}
        </article>)}
      </div>
      {!issues.length && quality.status !== "healthy" && <EmptyState title="No hay coincidencias" description="Prueba otra prioridad o término de búsqueda." />}
    </section>
  </>;
}

function AuditView({ audit, filters, setFilters, onSubmit, loading, pages, onPage }) {
  const update = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  return <section className="control-workspace" aria-labelledby="audit-title">
    <div className="control-workspace__heading"><div><p className="eyebrow">Trazabilidad</p><h2 id="audit-title">Actividad del sistema</h2></div><span>{audit.total} eventos</span></div>
    <form className="control-filterbar control-filterbar--audit" onSubmit={onSubmit}>
      <SearchInput value={filters.query} onChange={(event) => update("query", event.target.value)} placeholder="Usuario, acción o detalle" />
      <Select value={filters.action} onChange={(event) => update("action", event.target.value)} aria-label="Filtrar por acción"><option value="all">Todas las acciones</option>{sortAuditActions(audit.facets.actions).map((action) => <option key={action} value={action}>{formatAuditAction(action)}</option>)}</Select>
      <Select value={filters.entity} onChange={(event) => update("entity", event.target.value)} aria-label="Filtrar por entidad"><option value="all">Todas las entidades</option>{audit.facets.entities.map((entity) => <option key={entity} value={entity}>{entity}</option>)}</Select>
      <Button variant="secondary" type="submit" disabled={loading}>Filtrar</Button>
    </form>
    <Card className="control-audit-table">
      <div className="responsive-table"><table><thead><tr><th>Fecha</th><th>Responsable</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>
        {audit.records.map((event) => <tr key={event.id}><td className="audit-date">{formatDate(event.createdAt)}</td><td><strong>{event.actorName}</strong><small>{event.actorEmail} · {ROLE_LABELS[event.actorRole] || event.actorRole}</small></td><td><span className="audit-action">{formatAuditAction(event.action)}</span></td><td>{event.entity}<small>{event.entityId || ""}</small></td><td>{event.description}</td></tr>)}
        {!loading && !audit.records.length && <tr><td colSpan="5">No hay eventos para los filtros seleccionados.</td></tr>}
      </tbody></table></div>
    </Card>
    <div className="academic-pagination"><Button variant="ghost" disabled={audit.page <= 1 || loading} onClick={() => onPage(audit.page - 1)}>Anterior</Button><span>Página {audit.page} de {pages}</span><Button variant="ghost" disabled={audit.page >= pages || loading} onClick={() => onPage(audit.page + 1)}>Siguiente</Button></div>
  </section>;
}
