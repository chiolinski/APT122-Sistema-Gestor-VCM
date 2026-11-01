import { AlertCircle, Building2, CheckCircle2, Download, FileSpreadsheet, History, ListTree, LoaderCircle, Mail, Pencil, Phone, Plus, Save, Search, Upload, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Field, Input, PageHeader, SearchInput } from "../components/UI";
import { useApp } from "../context/AppContext";
import { applyPartnerImport, listPartnerImports, parsePartnerCsv, previewPartnerImport } from "../services/partnerImportApi";

const emptyPartner = { businessName: "", taxId: "", contactName: "", contactEmail: "", phone: "", industry: "" };

export default function PartnersPage() {
  const { session, partners, addPartner, editPartner, refreshOperationalData } = useApp();
  const inputRef = useRef(null);
  const [activeTab, setActiveTab] = useState("catalog");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingPartnerId, setEditingPartnerId] = useState("");
  const [form, setForm] = useState(emptyPartner);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [fileState, setFileState] = useState(null);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const filtered = useMemo(() => partners.filter((partner) =>
    `${partner.businessName} ${partner.taxId} ${partner.industry}`.toLowerCase().includes(query.toLowerCase())), [partners, query]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await listPartnerImports());
    } catch (error) {
      setMessage(error.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "import") loadHistory();
  }, [activeTab, loadHistory]);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.businessName || !form.taxId || !form.contactName || !form.contactEmail) return;
    setSaving(true);
    setMessage("");
    try {
      if (editingPartnerId) await editPartner(editingPartnerId, form);
      else await addPartner(form);
      setForm(emptyPartner);
      setEditingPartnerId("");
      setShowForm(false);
      setMessage(editingPartnerId ? "Socio formador actualizado correctamente." : "Socio formador guardado correctamente.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  const openNewPartner = () => {
    setForm(emptyPartner);
    setEditingPartnerId("");
    setShowForm((visible) => !visible || Boolean(editingPartnerId));
    setMessage("");
  };

  const openPartnerEditor = (partner) => {
    setForm({
      businessName: partner.businessName || "",
      taxId: partner.taxId || "",
      industry: partner.industry || "",
      contactName: partner.contactName || "",
      contactEmail: partner.contactEmail || "",
      phone: partner.phone || "",
    });
    setEditingPartnerId(partner.id);
    setShowForm(true);
    setMessage("");
  };

  const closePartnerForm = () => {
    setForm(emptyPartner);
    setEditingPartnerId("");
    setShowForm(false);
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMessage("");
    setFileState(null);
    try {
      const rows = await parsePartnerCsv(file);
      const preview = await previewPartnerImport(rows);
      setFileState({ file, rows, preview });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const confirmImport = async () => {
    if (!fileState?.preview.canApply) return;
    setImporting(true);
    setMessage("");
    try {
      const result = await applyPartnerImport(fileState.file.name, fileState.rows);
      setMessage(result.duplicate
        ? "Esta misma carga ya había sido aplicada y no se duplicó información."
        : `Carga aplicada: ${result.created} socios creados y ${result.updated} actualizados.`);
      setFileState(null);
      await Promise.all([refreshOperationalData(), loadHistory()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Catálogo compartido"
        title="Socios formadores"
        description="Cada organización queda disponible para todos los coordinadores CITT y directores de carrera."
        actions={activeTab === "catalog"
          ? <Button icon={showForm ? X : Plus} onClick={showForm ? closePartnerForm : openNewPartner}>{showForm ? "Cerrar formulario" : "Nuevo socio"}</Button>
          : <><a href="/templates/carga-socios-formadores.csv" download><Button variant="secondary" icon={Download}>Descargar plantilla</Button></a><Button icon={Upload} onClick={() => inputRef.current?.click()} disabled={importing}>{importing ? "Procesando..." : "Cargar CSV"}</Button><input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={handleFile} /></>}
      />

      <div className="page-tabs" role="tablist" aria-label="Administración de socios formadores">
        <button type="button" role="tab" aria-selected={activeTab === "catalog"} className={activeTab === "catalog" ? "is-active" : ""} onClick={() => setActiveTab("catalog")}><ListTree size={17} /> Catálogo</button>
        <button type="button" role="tab" aria-selected={activeTab === "import"} className={activeTab === "import" ? "is-active" : ""} onClick={() => { setActiveTab("import"); setShowForm(false); }}><Upload size={17} /> Carga masiva</button>
      </div>

      {message && <div className="notice-banner"><Building2 size={20} /><div><strong>Socios formadores</strong><p>{message}</p></div><button onClick={() => setMessage("")}>×</button></div>}

      {activeTab === "catalog" ? <Catalog
        canEdit={session.role === "admin"} editingPartnerId={editingPartnerId} filtered={filtered} form={form} query={query} saving={saving} showForm={showForm}
        onEdit={openPartnerEditor} onFormChange={setForm} onQueryChange={setQuery} onSubmit={submit}
      /> : <ImportPanel
        fileState={fileState} history={history} historyLoading={historyLoading} importing={importing}
        onApply={confirmImport} onCancel={() => setFileState(null)} onChoose={() => inputRef.current?.click()}
      />}
    </>
  );
}

function Catalog({ canEdit, editingPartnerId, filtered, form, onEdit, onFormChange, onQueryChange, onSubmit, query, saving, showForm }) {
  return <>
    {showForm && (
      <Card className="form-section compact-form">
        <div className="form-section__heading"><span><Building2 size={19} /></span><div><h2>{editingPartnerId ? "Editar socio formador" : "Crear socio formador"}</h2><p>{editingPartnerId ? "Corrige los datos de la organización y su contraparte." : "Registra los datos básicos y una contraparte de contacto."}</p></div></div>
        <form onSubmit={onSubmit} className="form-grid form-grid--three">
          <Field label="Razón social" required><Input value={form.businessName} maxLength={350} onChange={(event) => onFormChange({ ...form, businessName: event.target.value })} /></Field>
          <Field label="RUT" required><Input value={form.taxId} onChange={(event) => onFormChange({ ...form, taxId: event.target.value })} placeholder="76.123.456-0" /></Field>
          <Field label="Rubro"><Input value={form.industry} onChange={(event) => onFormChange({ ...form, industry: event.target.value })} /></Field>
          <Field label="Nombre de contacto" required><Input value={form.contactName} onChange={(event) => onFormChange({ ...form, contactName: event.target.value })} /></Field>
          <Field label="Correo de contacto" required><Input type="email" value={form.contactEmail} onChange={(event) => onFormChange({ ...form, contactEmail: event.target.value })} /></Field>
          <Field label="Teléfono"><Input value={form.phone} inputMode="tel" pattern="[0-9+() ]*" placeholder="+56912345678 +5621234567" title="Uno o dos teléfonos; usa números, espacios, paréntesis y + al inicio" onChange={(event) => onFormChange({ ...form, phone: event.target.value })} /></Field>
          <div className="field--full form-actions"><Button type="submit" icon={saving ? LoaderCircle : editingPartnerId ? Save : Plus} disabled={saving}>{saving ? "Guardando..." : editingPartnerId ? "Guardar cambios" : "Crear socio formador"}</Button></div>
        </form>
      </Card>
    )}
    <Card className="panel-card">
      <div className="toolbar"><SearchInput value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar por nombre, RUT o rubro" /><span>{filtered.length} socios</span></div>
      <div className="partner-grid">
        {filtered.map((partner) => (
          <article key={partner.id} className="partner-card">
            <div className="partner-card__top"><span><Building2 size={21} /></span><div className="partner-card__actions"><small>{partner.taxId}</small>{canEdit && <button type="button" onClick={() => onEdit(partner)} aria-label={`Editar ${partner.businessName}`} title="Editar socio formador"><Pencil size={15} /> Editar</button>}</div></div>
            <h3>{partner.businessName}</h3>
            <p>{partner.industry || "Rubro no informado"}</p>
            <div className="partner-contact">
              <span><UserRound size={15} /> {partner.contactName}</span>
              <span><Mail size={15} /> {partner.contactEmail}</span>
              {partner.phone && <span><Phone size={15} /> {partner.phone}</span>}
            </div>
          </article>
        ))}
        {!filtered.length && <div className="selection-empty"><Search size={19} /> No se encontraron socios formadores.</div>}
      </div>
    </Card>
  </>;
}

function ImportPanel({ fileState, history, historyLoading, importing, onApply, onCancel, onChoose }) {
  return <>
    <div className="notice-banner notice-banner--success"><FileSpreadsheet size={20} /><div><strong>Carga segura mediante CSV</strong><p>Los socios existentes se actualizan por RUT y los nuevos se incorporan al catálogo compartido. Ningún cambio se realiza antes de confirmar.</p></div></div>
    {fileState
      ? <ImportPreview state={fileState} loading={importing} onApply={onApply} onCancel={onCancel} />
      : <Card className="partner-import-empty"><Upload size={28} /><div><h2>Selecciona el archivo de socios formadores</h2><p>Utiliza la plantilla CSV, con un máximo de 5.000 filas por carga.</p></div><Button icon={Upload} onClick={onChoose} disabled={importing}>{importing ? "Validando..." : "Seleccionar CSV"}</Button></Card>}
    <Card className="panel-card table-card">
      <div className="card-heading"><div><p className="eyebrow">Auditoría</p><h2>Últimas cargas masivas</h2></div><History size={20} /></div>
      <div className="responsive-table">
        <table>
          <thead><tr><th>Fecha</th><th>Archivo</th><th>Responsable</th><th>Socios</th><th>Creados</th><th>Actualizados</th></tr></thead>
          <tbody>
            {history.map((item) => <tr key={item.id}><td>{formatDate(item.appliedAt)}</td><td><strong>{item.filename}</strong></td><td>{item.appliedBy}</td><td>{item.partners}</td><td>{item.created}</td><td>{item.updated}</td></tr>)}
            {!historyLoading && !history.length && <tr><td colSpan="6">Todavía no existen cargas masivas registradas.</td></tr>}
            {historyLoading && <tr><td colSpan="6">Consultando historial...</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  </>;
}

function ImportPreview({ state, loading, onApply, onCancel }) {
  const { preview, file } = state;
  const hasErrors = preview.issues.some((issue) => issue.level === "error");
  return <Card className="import-preview">
    <div className="import-preview__header">
      <span><FileSpreadsheet size={22} /></span>
      <div><p className="eyebrow">Previsualización</p><h2>{file.name}</h2><small>{preview.summary.rows} filas leídas · {(file.size / 1024).toFixed(1)} KB</small></div>
      <button className="icon-button" onClick={onCancel} aria-label="Quitar archivo"><X size={18} /></button>
    </div>
    <div className="import-summary">
      <span><strong>{preview.summary.partners}</strong>Socios únicos</span>
      <span><strong>{preview.summary.creates}</strong>Nuevos</span>
      <span><strong>{preview.summary.updates}</strong>Actualizaciones</span>
      <span><strong>{preview.summary.duplicates}</strong>Repetidos</span>
      <span><strong>{preview.summary.errors}</strong>Errores</span>
      <span><strong>{preview.summary.warnings}</strong>Advertencias</span>
    </div>
    {preview.issues.length > 0
      ? <div className={`import-issues ${hasErrors ? "" : "import-issues--warnings"}`}>{preview.issues.slice(0, 12).map((issue, index) => <p key={`${issue.row}-${issue.code}-${index}`}><AlertCircle size={15} /><span><strong>{issue.row ? `Fila ${issue.row}: ` : ""}</strong>{issue.message}</span></p>)}</div>
      : <div className="import-ready"><CheckCircle2 size={18} /> El archivo está listo para aplicar.</div>}
    {preview.canApply && preview.issues.length > 0 && <div className="import-ready"><CheckCircle2 size={18} /> Las advertencias no bloquean la carga; los registros repetidos se procesarán una sola vez.</div>}
    <div className="form-actions"><Button variant="ghost" onClick={onCancel}>Cancelar</Button><Button icon={loading ? LoaderCircle : Upload} disabled={!preview.canApply || loading} onClick={onApply}>{loading ? "Aplicando..." : "Aplicar carga"}</Button></div>
  </Card>;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
