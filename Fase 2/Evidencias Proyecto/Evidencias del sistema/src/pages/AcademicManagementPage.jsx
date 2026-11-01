import { ArrowLeft, ArrowRightLeft, CheckCircle2, LoaderCircle, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "../components/UI";
import { managementCatalogs, managementSections, managementSection, managementPeople,
  previewAdjustment, applyAdjustment, registerManagementTeacher } from "../services/academicManagementApi";

const ACTIONS = {
  teachers: [
    ["TEACHER_ASSIGN", "Asignar profesor"], ["TEACHER_REPLACE", "Reemplazar profesor"],
    ["TEACHER_SWAP", "Intercambiar profesores entre secciones"], ["TEACHER_REMOVE", "Retirar profesor de esta sección"],
  ],
  students: [
    ["STUDENT_ADD", "Agregar alumno por nombre y RUT"], ["STUDENT_ENROLL", "Matricular alumno existente"],
    ["STUDENT_MOVE", "Trasladar alumno a otra sección"], ["STUDENT_SWAP", "Intercambiar alumnos entre secciones"],
    ["STUDENT_REMOVE", "Retirar alumno de esta sección"],
  ],
};
const emptyForm = (action) => ({ action, teacherId: "", previousTeacherId: "", studentId: "", otherTeacherId: "",
  otherStudentId: "", targetSectionId: "", name: "", rut: "", reason: "" });
const sectionLabel = (section) => `${section.subjectCode} / ${section.code} · ${section.campusName} · ${section.period}`;

function useSectionDetail(id, revision = 0) {
  const [state, setState] = useState({ data: null, loading: false, error: "" });
  useEffect(() => {
    if (!id) { setState({ data: null, loading: false, error: "" }); return; }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: "" });
    managementSection(id, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: "" });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [id, revision]);
  return state;
}

function SectionPicker({ catalogs, value, onChange, label, disabled, excludeId = "" }) {
  const [filters, setFilters] = useState({ query: "", campusId: "", period: "" });
  const [result, setResult] = useState({ records: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      managementSections(filters, controller.signal).then((next) => {
        if (!controller.signal.aborted) { setResult(next); setLoading(false); }
      }).catch((failure) => {
        if (!controller.signal.aborted) { setError(failure.message); setResult({ records: [], total: 0 }); setLoading(false); }
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters]);
  const filter = (key, next) => { onChange(""); setFilters((current) => ({ ...current, [key]: next })); };
  return <div className="academic-section-picker">
    <div className="form-grid form-grid--three">
      <Field label="Sede"><Select value={filters.campusId} onChange={(event) => filter("campusId", event.target.value)} disabled={disabled}>
        <option value="">Todas las sedes</option>{catalogs.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
      </Select></Field>
      <Field label="Período"><Select value={filters.period} onChange={(event) => filter("period", event.target.value)} disabled={disabled}>
        <option value="">Todos los períodos</option>{catalogs.periods.map((period) => <option key={period.code} value={period.code}>{period.code}</option>)}
      </Select></Field>
      <Field label="Buscar asignatura o sección"><Input value={filters.query} onChange={(event) => filter("query", event.target.value)} placeholder="Ej. SIY6122 o 003D" disabled={disabled} /></Field>
    </div>
    <Field label={label} required hint={result.total > 100 ? `${result.total} coincidencias; se muestran 100. Refina la búsqueda.` : `${result.total} sección(es) encontrada(s)`}>
      <Select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || loading || Boolean(error)} required>
        <option value="">{loading ? "Buscando secciones..." : "Selecciona una sección"}</option>
        {result.records.filter((section) => section.id !== excludeId).map((section) => <option key={section.id} value={section.id}>{sectionLabel(section)}</option>)}
      </Select>
    </Field>
    {error && <p className="notice-banner notice-banner--error" role="alert">{error}</p>}
  </div>;
}

function PersonPicker({ entity, value, onChange, label, disabled, revision }) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      managementPeople(entity, query, controller.signal).then((data) => {
        if (!controller.signal.aborted) { setRecords(data); setLoading(false); }
      }).catch((failure) => {
        if (!controller.signal.aborted) { setRecords([]); setError(failure.message); setLoading(false); }
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [entity, query, revision]);
  return <div className="academic-person-picker">
    <Field label={`Buscar ${entity === "teachers" ? "profesor" : "alumno"}`} hint={entity === "teachers"
      ? "Todos los profesores activos de todas las sedes. Puedes filtrar por nombre, código o correo."
      : "Por nombre, código, RUT o correo; hasta 50 resultados"}>
      <Input value={query} onChange={(event) => { setQuery(event.target.value); onChange(""); }} disabled={disabled} placeholder="Escribe para buscar..." />
    </Field>
    <Field label={label} required hint={entity === "teachers" && !loading && !error ? `${records.length} profesor(es) encontrado(s)` : undefined}><Select value={value} onChange={(event) => onChange(event.target.value)} required disabled={disabled || loading || Boolean(error)}>
      <option value="">{loading ? "Buscando..." : "Selecciona una persona"}</option>
      {records.map((person) => <option key={person.id} value={person.id} disabled={entity === "teachers" && !person.accountReady}>
        {person.name} · {person.sourceId || person.rut}{person.email ? ` · ${person.email}` : ""}
        {entity === "teachers" && !person.accountReady ? " · requiere cuenta habilitada en Usuarios" : ""}
      </option>)}
    </Select></Field>
    {error && <p role="alert" className="notice-banner notice-banner--error">{error}</p>}
  </div>;
}

function RosterSelect({ records, label, value, onChange, disabled }) {
  return <Field label={label} required><Select value={value} onChange={(event) => onChange(event.target.value)} required disabled={disabled}>
    <option value="">Selecciona una persona de esta sección</option>
    {records.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.rut || person.sourceId}{person.active === false ? " · registro inactivo" : ""}</option>)}
  </Select></Field>;
}

export default function AcademicManagementPage() {
  const { refreshOperationalData } = useApp();
  const [catalogs, setCatalogs] = useState({ campuses: [], periods: [] });
  const [catalogError, setCatalogError] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [tab, setTab] = useState("teachers");
  const [form, setForm] = useState(emptyForm("TEACHER_ASSIGN"));
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [code, setCode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const detail = useSectionDetail(sectionId, revision);
  const destination = useSectionDetail(form.targetSectionId, revision);
  const data = detail.data;
  const needsDestination = ["TEACHER_SWAP", "STUDENT_MOVE", "STUDENT_SWAP"].includes(form.action);
  const blocked = busy || !data || Boolean(data.lockedReason) || Boolean(catalogError);

  useEffect(() => {
    let active = true;
    managementCatalogs().then((next) => { if (active) setCatalogs(next); }).catch((error) => { if (active) setCatalogError(error.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!confirmation || busy) return;
    const close = (event) => { if (event.key === "Escape") setConfirmation(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [confirmation, busy]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const selectSection = (id) => { setSectionId(id); setForm(emptyForm(ACTIONS[tab][0][0])); setMessage(null); };
  const selectTab = (next) => { setTab(next); setForm(emptyForm(ACTIONS[next][0][0])); setMessage(null); };
  const handlePreview = async (event) => {
    event.preventDefault();
    if (blocked) return;
    setBusy(true); setMessage(null);
    try {
      const input = { ...form, sectionId };
      const plan = await previewAdjustment(input);
      setConfirmation({ input, plan }); setCode(""); setAcknowledged(false);
    } catch (error) { setMessage({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  };
  const handleApply = async (event) => {
    event.preventDefault();
    if (!confirmation || busy || !acknowledged || code.trim() !== confirmation.plan.confirmationCode) return;
    setBusy(true); setMessage(null);
    try {
      const result = await applyAdjustment({ ...confirmation.input, confirmed: true, confirmationCode: code.trim(), previewVersion: confirmation.plan.version });
      setConfirmation(null); setForm(emptyForm(ACTIONS[tab][0][0])); setRevision((current) => current + 1);
      setMessage({ tone: "success", text: `${result.title}: cambio aplicado y registrado en auditoría.` });
      await refreshOperationalData();
    } catch (error) {
      setConfirmation(null); setRevision((current) => current + 1);
      setMessage({ tone: "error", text: error.message });
    } finally { setBusy(false); }
  };

  return <>
    <PageHeader eyebrow="Herramienta interna · Solo administración" title="Ajustes académicos"
      description="Resuelve cambios de profesores y alumnos sin editar directamente la base de datos."
      actions={<Link to="/app/carga-academica"><Button variant="secondary" icon={ArrowLeft}>Carga académica</Button></Link>} />
    <div className="notice-banner"><ShieldCheck size={20} /><p>Las operaciones requieren vista previa, confirmación y motivo. No cambian los avances ni la autoría histórica. Actualiza también el archivo de origen antes de una nueva carga.</p></div>
    {catalogError && <div className="notice-banner notice-banner--error" role="alert"><p>{catalogError} No se muestran datos demostrativos.</p></div>}
    {message && <div className={`notice-banner notice-banner--${message.tone}`} role="status"><CheckCircle2 size={20} /><p>{message.text}</p></div>}
    <Card className="panel-card academic-management-panel">
      <div className="card-heading"><div><h2>1. Selecciona la sección principal</h2><p>Comprueba sede, asignatura y período antes de continuar.</p></div></div>
      <SectionPicker catalogs={catalogs} value={sectionId} onChange={selectSection} label="Sección principal" disabled={busy || Boolean(catalogError)} />
    </Card>
    {detail.loading && <p role="status" className="notice-banner"><LoaderCircle size={20} /> Cargando profesores, alumnos y proyectos...</p>}
    {detail.error && <p role="alert" className="notice-banner notice-banner--error">{detail.error}</p>}
    {data && <>
      <Card className="panel-card academic-management-panel">
        <div className="card-heading"><div><h2>{sectionLabel(data.section)}</h2><p>{data.section.subjectName}</p></div><span className="record-count"><Users size={14} /> {data.students.length} alumnos</span></div>
        {data.lockedReason && <p className="notice-banner notice-banner--error" role="alert">{data.lockedReason}</p>}
        <div className="academic-management-summary">
          <div><strong>Profesores vigentes</strong>{data.teachers.length ? data.teachers.map((teacher) => <p key={teacher.id}>{teacher.name} · {teacher.sourceId}</p>) : <p>Sin profesor asignado</p>}</div>
          <div><strong>Proyectos vinculados</strong>{data.section.projects.length ? data.section.projects.map((project) => <p key={project.id}>{project.code} · {project.name} · {project.status}</p>) : <p>Sin proyectos vinculados</p>}</div>
        </div>
      </Card>
      <Card className="panel-card academic-management-panel">
        <div className="card-heading"><div><h2>2. Prepara el cambio</h2><p>Retirar desactiva solo la vinculación; no elimina a la persona.</p></div></div>
        <div className="page-tabs" role="tablist" aria-label="Tipo de ajuste académico">
          <button type="button" role="tab" aria-selected={tab === "teachers"} className={tab === "teachers" ? "is-active" : ""} onClick={() => selectTab("teachers")} disabled={busy}>Profesores</button>
          <button type="button" role="tab" aria-selected={tab === "students"} className={tab === "students" ? "is-active" : ""} onClick={() => selectTab("students")} disabled={busy}>Alumnos</button>
        </div>
        <form onSubmit={handlePreview} className="academic-adjustment-form">
          <Field label="Operación" required><Select value={form.action} onChange={(event) => setForm(emptyForm(event.target.value))} disabled={blocked}>
            {ACTIONS[tab].map(([action, label]) => <option key={action} value={action}>{label}</option>)}
          </Select></Field>
          {["TEACHER_ASSIGN", "TEACHER_REPLACE"].includes(form.action) && <PersonPicker key={form.action} entity="teachers" value={form.teacherId} onChange={(id) => update("teacherId", id)} label="Profesor entrante" disabled={blocked} revision={revision} />}
          {form.action === "TEACHER_REPLACE" && <RosterSelect records={data.teachers} label="Profesor saliente" value={form.previousTeacherId} onChange={(id) => update("previousTeacherId", id)} disabled={blocked} />}
          {["TEACHER_REMOVE", "TEACHER_SWAP"].includes(form.action) && <RosterSelect records={data.teachers} label="Profesor de la sección principal" value={form.teacherId} onChange={(id) => update("teacherId", id)} disabled={blocked} />}
          {form.action === "STUDENT_ADD" && <div className="form-grid">
            <Field label="Nombre completo del alumno" required><Input value={form.name} onChange={(event) => update("name", event.target.value)} minLength="2" maxLength="180" required disabled={blocked} /></Field>
            <Field label="RUT" required hint="Se valida el dígito verificador; no se acepta 00000000-0"><Input value={form.rut} onChange={(event) => update("rut", event.target.value)} placeholder="12.345.678-5" required disabled={blocked} /></Field>
          </div>}
          {form.action === "STUDENT_ENROLL" && <PersonPicker key={form.action} entity="students" value={form.studentId} onChange={(id) => update("studentId", id)} label="Alumno existente" disabled={blocked} revision={revision} />}
          {["STUDENT_MOVE", "STUDENT_REMOVE", "STUDENT_SWAP"].includes(form.action) && <RosterSelect records={data.students} label="Alumno de la sección principal" value={form.studentId} onChange={(id) => update("studentId", id)} disabled={blocked} />}
          {needsDestination && <div className="academic-management-destination">
            <h3>Segunda sección / destino</h3>
            <p>{tab === "students" ? "Debe pertenecer a la misma asignatura y período. Puede estar en otra sede." : "El intercambio requiere el mismo período; las asignaturas pueden ser distintas."}</p>
            <SectionPicker key={form.action} catalogs={catalogs} value={form.targetSectionId} onChange={(id) => setForm((current) => ({ ...current, targetSectionId: id, otherTeacherId: "", otherStudentId: "" }))}
              label="Segunda sección" disabled={blocked} excludeId={sectionId} />
            {destination.loading && <p role="status">Cargando la segunda sección...</p>}
            {destination.error && <p role="alert" className="notice-banner notice-banner--error">{destination.error}</p>}
            {destination.data?.lockedReason && <p role="alert" className="notice-banner notice-banner--error">{destination.data.lockedReason}</p>}
            {destination.data && form.action === "TEACHER_SWAP" && <RosterSelect records={destination.data.teachers} label="Profesor de la segunda sección" value={form.otherTeacherId} onChange={(id) => update("otherTeacherId", id)} disabled={blocked} />}
            {destination.data && form.action === "STUDENT_SWAP" && <RosterSelect records={destination.data.students} label="Alumno de la segunda sección" value={form.otherStudentId} onChange={(id) => update("otherStudentId", id)} disabled={blocked} />}
          </div>}
          <Field label="Motivo del cambio" required hint="Entre 10 y 500 caracteres; quedará en auditoría"><Textarea rows="3" minLength="10" maxLength="500" value={form.reason} onChange={(event) => update("reason", event.target.value)} required disabled={blocked} /></Field>
          <div className="form-actions"><Button type="submit" icon={busy ? LoaderCircle : ArrowRightLeft}
            disabled={blocked || (needsDestination && (!destination.data || Boolean(destination.data.lockedReason)))}>{busy ? "Validando..." : "Revisar cambio antes de aplicar"}</Button></div>
        </form>
      </Card>
    </>}
    <TeacherRegistration busy={busy} onRegistered={(text) => { setMessage({ tone: "success", text }); setRevision((current) => current + 1); }} />
    {confirmation && <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) setConfirmation(null); }}>
      <section className="modal academic-adjustment-modal" role="dialog" aria-modal="true" aria-labelledby="adjustment-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="icon-button modal-close" aria-label="Cerrar confirmación" disabled={busy} onClick={() => setConfirmation(null)}><X size={18} /></button>
        <span className="modal__icon"><ShieldCheck size={22} /></span><h2 id="adjustment-confirm-title">3. Confirma el cambio</h2><p>{confirmation.plan.title}</p>
        <div className="academic-adjustment-changes">{confirmation.plan.changes.map((change, index) => <div key={index}>
          <strong>{change.person}</strong><p><span>Desde:</span> {change.from}</p><p><span>Hacia:</span> {change.to}</p>
        </div>)}</div>
        <p><strong>Motivo:</strong> {confirmation.plan.reason}</p>
        <ul className="academic-adjustment-warnings">{confirmation.plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        <form onSubmit={handleApply}>
          <Field label={`Escribe ${confirmation.plan.confirmationCode} para confirmar`} required><Input value={code} onChange={(event) => setCode(event.target.value)} required disabled={busy} autoFocus autoComplete="off" /></Field>
          <label className="academic-adjustment-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} required /> Revisé las personas, sedes, períodos y efectos del cambio.</label>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setConfirmation(null)} disabled={busy}>Cancelar</Button><Button type="submit" icon={busy ? LoaderCircle : ShieldCheck} disabled={busy || !acknowledged || code.trim() !== confirmation.plan.confirmationCode}>{busy ? "Aplicando..." : "Aplicar cambio"}</Button></div>
        </form>
      </section>
    </div>}
  </>;
}

function TeacherRegistration({ busy, onRegistered }) {
  const [form, setForm] = useState({ name: "", sourceId: "", email: "", reason: "", confirmed: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || saving;
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const register = async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const result = await registerManagementTeacher(form);
      setForm({ name: "", sourceId: "", email: "", reason: "", confirmed: false });
      onRegistered(result.needsAccount ? "Profesor registrado. Crea su cuenta en Usuarios usando su código académico antes de asignarlo." : "Profesor registrado y vinculado a su cuenta existente. Verifica que esté habilitada en Usuarios.");
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return <Card className="panel-card academic-management-panel"><details>
    <summary>Registrar un profesor que todavía no está en la carga académica</summary>
    <p>Esto crea su registro académico. Las contraseñas y la habilitación de acceso se gestionan en <Link to="/app/usuarios">Usuarios</Link>; no se modifican cuentas existentes.</p>
    {error && <p role="alert" className="notice-banner notice-banner--error">{error}</p>}
    <form className="academic-adjustment-form" onSubmit={register}>
      <div className="form-grid form-grid--three">
        <Field label="Nombre completo" required><Input value={form.name} onChange={(event) => update("name", event.target.value)} minLength="3" maxLength="180" disabled={disabled} required /></Field>
        <Field label="RUT o código académico" required><Input value={form.sourceId} onChange={(event) => update("sourceId", event.target.value)} maxLength="40" disabled={disabled} required /></Field>
        <Field label="Correo institucional" required><Input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} maxLength="320" disabled={disabled} required /></Field>
      </div>
      <Field label="Motivo del registro" required><Textarea rows="2" value={form.reason} onChange={(event) => update("reason", event.target.value)} minLength="10" maxLength="500" disabled={disabled} required /></Field>
      <label className="academic-adjustment-acknowledgement"><input type="checkbox" checked={form.confirmed} onChange={(event) => update("confirmed", event.target.checked)} disabled={disabled} required /> Confirmo que el código, nombre y correo corresponden al profesor que deseo registrar.</label>
      <div className="form-actions"><Button type="submit" disabled={disabled || !form.confirmed} icon={saving ? LoaderCircle : Users}>{saving ? "Registrando..." : "Registrar profesor"}</Button></div>
    </form>
  </details></Card>;
}
