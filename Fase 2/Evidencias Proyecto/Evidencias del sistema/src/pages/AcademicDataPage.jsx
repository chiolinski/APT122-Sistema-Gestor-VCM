import { AlertCircle, BookOpen, Building2, CheckCircle2, Database, Download, FileSpreadsheet, ListTree, LoaderCircle, School, Upload, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, MetricCard, PageHeader } from "../components/UI";
import AcademicExplorer from "../components/AcademicExplorer";
import { campuses, sections, subjects } from "../data/catalogs";
import { applyAcademicImport, getAcademicCatalogs, parseAcademicCsv, previewAcademicRows } from "../services/academicApi";

export default function AcademicDataPage() {
  const inputRef = useRef(null);
  const [catalogs, setCatalogs] = useState({ campuses, schools: [], subjects, sections, studentCount: 0, source: "unavailable" });
  const [fileState, setFileState] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("import");

  useEffect(() => { getAcademicCatalogs().then(setCatalogs).catch((error) => setMessage(error.message)); }, []);

  const chooseFile = () => inputRef.current?.click();
  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    try {
      const rows = await parseAcademicCsv(file);
      setFileState({ file, rows, preview: previewAcademicRows(rows) });
    } catch (error) {
      setFileState(null);
      setMessage(error.message);
    }
    event.target.value = "";
  };

  const applyImport = async () => {
    if (!fileState?.preview.canApply) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await applyAcademicImport(fileState.file.name, fileState.rows);
      setMessage(result.duplicate ? "Esta carga ya había sido aplicada anteriormente." : "Carga académica aplicada correctamente.");
      setFileState(null);
      setCatalogs(await getAcademicCatalogs());
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Datos maestros"
        title="Carga académica"
        description="Esta información debe estar disponible antes de vincular propuestas y habilitar el panel docente."
        actions={activeTab === "import" ? <><a href="/templates/carga-academica-2026.csv" download><Button variant="secondary" icon={Download}>Descargar plantilla</Button></a><Button icon={Upload} onClick={chooseFile}>Cargar CSV</Button><input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={handleFile} /></> : null}
      />
      <div className="page-tabs" role="tablist" aria-label="Administración de carga académica">
        <button type="button" role="tab" aria-selected={activeTab === "import"} className={activeTab === "import" ? "is-active" : ""} onClick={() => setActiveTab("import")}><Upload size={17} /> Cargar y revisar</button>
        <button type="button" role="tab" aria-selected={activeTab === "records"} className={activeTab === "records" ? "is-active" : ""} onClick={() => setActiveTab("records")}><ListTree size={17} /> Explorar y corregir datos</button>
      </div>

      <p className="academic-management-entry"><Link to="/app/ajustes-academicos">Herramienta interna: ajustes de profesores y alumnos</Link></p>

      {activeTab === "records" ? <AcademicExplorer /> : <>
      <div className={`notice-banner ${catalogs.source === "vcm_piloto_2026_local" ? "notice-banner--success" : ""}`}><Database size={20} /><div><strong>{catalogs.source === "vcm_piloto_2026_local" ? "Conectado a vcm_piloto_2026_local" : "Conexión local pendiente"}</strong><p>{catalogs.source === "vcm_piloto_2026_local" ? "Los indicadores y catálogos provienen de la base SQL Server local de pruebas." : "Inicia la API y la base local para consultar los datos de pruebas."}</p></div></div>
      {message && <div className="notice-banner"><AlertCircle size={20} /><div><strong>Estado de la carga</strong><p>{message}</p></div><button onClick={() => setMessage("")}>×</button></div>}
      {fileState && <ImportPreview state={fileState} loading={loading} onCancel={() => setFileState(null)} onApply={applyImport} />}
      <div className="metrics-grid academic-metrics-grid">
        <MetricCard icon={Building2} label="Sedes" value={catalogs.campuses.length} detail="Catálogo institucional" />
        <MetricCard icon={School} label="Escuelas" value={catalogs.schools?.length || 0} detail="Ligadas a las asignaturas" />
        <MetricCard icon={BookOpen} label="Asignaturas" value={catalogs.subjects.length} detail="Con código y nombre" tone="blue" />
        <MetricCard icon={FileSpreadsheet} label="Secciones" value={catalogs.sections.length} detail="Ligadas a sede y asignatura" tone="green" />
        <MetricCard icon={Users} label="Estudiantes" value={catalogs.studentCount} detail={catalogs.source === "demo" ? "Nómina demostrativa" : "Matrículas vigentes"} tone="purple" />
      </div>
      <div className="academic-grid">
        <Card className="panel-card">
          <div className="card-heading"><div><p className="eyebrow">Catálogo</p><h2>Asignaturas</h2></div></div>
          <div className="simple-list">
            {catalogs.subjects.slice(0, 8).map((subject) => <div key={subject.id || subject.code}><span><BookOpen size={17} /></span><div><strong>{subject.name}</strong><small>{subject.code}</small></div><CheckCircle2 size={17} /></div>)}
          </div>
        </Card>
        <Card className="panel-card">
          <div className="card-heading"><div><p className="eyebrow">Regla académica</p><h2>Integridad de matrícula</h2></div></div>
          <div className="rule-card"><span>01</span><p><strong>Una sección por asignatura</strong>Un estudiante no puede estar matriculado en dos secciones distintas de la misma asignatura.</p></div>
          <div className="rule-card"><span>02</span><p><strong>Asignación docente</strong>El acceso docente se deriva de las secciones que imparte, no de una asignación manual al proyecto.</p></div>
          <div className="rule-card"><span>03</span><p><strong>Vinculación directa</strong>Cada proyecto se liga a una asignatura y a una o más secciones participantes.</p></div>
        </Card>
      </div>
      </>}
    </>
  );
}

function ImportPreview({ state, loading, onCancel, onApply }) {
  const { preview, file } = state;
  return (
    <Card className="import-preview">
      <div className="import-preview__header">
        <span><FileSpreadsheet size={22} /></span>
        <div><p className="eyebrow">Previsualización</p><h2>{file.name}</h2><small>{preview.summary.rows} filas leídas · {(file.size / 1024).toFixed(1)} KB</small></div>
        <button className="icon-button" onClick={onCancel} aria-label="Quitar archivo"><X size={18} /></button>
      </div>
      <div className="import-summary">
        <span><strong>{preview.summary.campuses}</strong>Sedes</span><span><strong>{preview.summary.schools}</strong>Escuelas</span><span><strong>{preview.summary.subjects}</strong>Asignaturas</span>
        <span><strong>{preview.summary.sections}</strong>Secciones</span><span><strong>{preview.summary.teachers}</strong>Docentes</span><span><strong>{preview.summary.students}</strong>Estudiantes</span>
      </div>
      {preview.issues.length > 0 ? <div className="import-issues">{preview.issues.slice(0, 8).map((issue, index) => <p key={`${issue.row}-${index}`}><AlertCircle size={15} /><span><strong>{issue.row ? `Fila ${issue.row}: ` : ""}</strong>{issue.message}</span></p>)}</div> : <div className="import-ready"><CheckCircle2 size={18} /> El archivo pasó las validaciones iniciales y está listo para cargar.</div>}
      <div className="form-actions"><Button variant="ghost" onClick={onCancel}>Cancelar</Button><Button icon={loading ? LoaderCircle : Upload} disabled={!preview.canApply || loading} onClick={onApply}>{loading ? "Aplicando..." : "Aplicar carga"}</Button></div>
    </Card>
  );
}
