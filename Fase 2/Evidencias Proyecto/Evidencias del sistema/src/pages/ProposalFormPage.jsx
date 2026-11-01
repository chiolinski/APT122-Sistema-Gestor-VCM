import { ArrowLeft, FileUp, Info, LoaderCircle, Plus, Save } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Field, Input, PageHeader, Select, Stepper, Textarea } from "../components/UI";
import { useApp } from "../context/AppContext";

const emptyForm = {
  partnerId: "",
  name: "",
  description: "",
  expectedResult: "",
  subjectId: "",
  campusIds: [],
  sectionIds: [],
};
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "png", "jpg", "jpeg", "zip"];

export default function ProposalFormPage() {
  const { partners, addProject, catalogs } = useApp();
  const { campuses, subjects, sections } = catalogs;
  const navigate = useNavigate();
  const attachmentInput = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [attachment, setAttachment] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const availableSections = useMemo(() => sections.filter((section) =>
    section.subjectId === form.subjectId && form.campusIds.includes(section.campusId)), [sections, form.subjectId, form.campusIds]);

  const campusMap = useMemo(() => new Map(campuses.map((campus) => [campus.id, campus.name])), [campuses]);

  const update = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "subjectId" ? { sectionIds: [] } : {}),
    }));
    setError("");
  };

  const toggleCampus = (campusId) => {
    setForm((current) => {
      const campusIds = current.campusIds.includes(campusId)
        ? current.campusIds.filter((id) => id !== campusId)
        : [...current.campusIds, campusId];
      const validSectionIds = new Set(sections
        .filter((section) => section.subjectId === current.subjectId && campusIds.includes(section.campusId))
        .map((section) => section.id));
      return { ...current, campusIds, sectionIds: current.sectionIds.filter((id) => validSectionIds.has(id)) };
    });
    setError("");
  };

  const selectAllCampuses = () => {
    const allSelected = form.campusIds.length === campuses.length;
    setForm((current) => ({
      ...current,
      campusIds: allSelected ? [] : campuses.map((campus) => campus.id),
      sectionIds: allSelected ? [] : current.sectionIds,
    }));
    setError("");
  };

  const toggleSection = (sectionId) => {
    setForm((current) => ({
      ...current,
      sectionIds: current.sectionIds.includes(sectionId)
        ? current.sectionIds.filter((id) => id !== sectionId)
        : [...current.sectionIds, sectionId],
    }));
    setError("");
  };

  const selectAllSections = () => {
    const allSelected = availableSections.length > 0 && form.sectionIds.length === availableSections.length;
    setForm((current) => ({ ...current, sectionIds: allSelected ? [] : availableSections.map((section) => section.id) }));
    setError("");
  };

  const selectAttachment = (file) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
      setError("El archivo debe ser PDF, Office, texto, imagen o ZIP.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("El archivo supera el máximo permitido de 15 MB.");
      return;
    }
    setAttachment(file);
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const required = [form.partnerId, form.name, form.description, form.expectedResult, form.subjectId];
    if (required.some((value) => !value) || form.campusIds.length === 0 || form.sectionIds.length === 0) {
      setError("Completa los campos obligatorios y selecciona al menos una sede y una sección responsable.");
      return;
    }
    if (availableSections.length === 0) {
      setError("No existen secciones activas para la asignatura y sedes seleccionadas.");
      return;
    }
    setSaving(true);
    try {
      const project = await addProject(form, attachment);
      navigate(`/app/proyectos/${project.id}`, {
        state: { created: true, uploadWarning: project.attachmentUploadError || "" },
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const step = form.name && form.description ? (form.subjectId && form.sectionIds.length ? 4 : 3) : (form.partnerId ? 2 : 1);

  return (
    <>
      <PageHeader
        eyebrow="Propuestas"
        title="Nueva propuesta de proyecto"
        description="Registra la propuesta en nombre del socio formador y vincúlala con la oferta académica del período."
        actions={<Link to="/app"><Button variant="secondary" icon={ArrowLeft}>Volver</Button></Link>}
      />
      <Stepper current={step} />

      <form className="form-stack" onSubmit={submit}>
        <Card className="form-section">
          <FormSectionHeading number="01" title="Socio formador" description="Selecciona una organización del catálogo compartido. Los socios no pertenecen a un coordinador específico." />
          <div className="form-grid form-grid--two">
            <Field label="Socio formador" required>
              <Select value={form.partnerId} onChange={(event) => update("partnerId", event.target.value)}>
                <option value="">Seleccionar socio formador</option>
                {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.businessName}</option>)}
              </Select>
            </Field>
            <div className="inline-callout">
              <span><Info size={18} /></span>
              <p>¿No encuentras la organización?</p>
              <Link to="/app/socios"><Plus size={15} /> Crear socio formador</Link>
            </div>
          </div>
        </Card>

        <Card className="form-section">
          <FormSectionHeading number="02" title="Descripción de la actividad" description="Resume el desafío, su contexto y el resultado que espera recibir el socio formador." />
          <div className="form-grid">
            <Field label="Nombre del proyecto" required>
              <Input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Ej. Plataforma de acompañamiento comunitario" />
            </Field>
            <Field label="Descripción de la actividad" hint={`${form.description.length}/1200 caracteres`} required>
              <Textarea rows="6" maxLength="1200" value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe el problema, las personas beneficiarias y el trabajo que desarrollarán los estudiantes..." />
            </Field>
            <div className={`upload-placeholder ${attachment ? "is-selected" : ""}`}>
              <span><FileUp size={22} /></span>
              <div><strong>{attachment?.name || "Documento de antecedentes"}</strong><p>{attachment ? `${formatFileSize(attachment.size)} · listo para subir con la propuesta` : "Adjunta bases, informes u otro material de apoyo (máximo 15 MB)."}</p></div>
              <Button type="button" variant="secondary" onClick={() => attachmentInput.current?.click()}>{attachment ? "Cambiar archivo" : "Subir archivo"}</Button>
              <input ref={attachmentInput} className="visually-hidden" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.zip" onChange={(event) => selectAttachment(event.target.files?.[0])} />
              {attachment && <button className="upload-placeholder__remove" type="button" onClick={() => { setAttachment(null); if (attachmentInput.current) attachmentInput.current.value = ""; }}>Quitar</button>}
            </div>
            <Field label="Resultado esperado" required>
              <Textarea rows="4" value={form.expectedResult} onChange={(event) => update("expectedResult", event.target.value)} placeholder="Indica el producto, servicio o resultado que se espera obtener..." />
            </Field>
          </div>
        </Card>

        <Card className="form-section">
          <FormSectionHeading number="03" title="Vinculación académica" description="Selecciona la asignatura, las sedes asociadas y las secciones responsables de ejecutar el proyecto." />
          <div className="form-grid form-grid--two">
            <Field label="Asignatura" required>
              <Select value={form.subjectId} onChange={(event) => update("subjectId", event.target.value)}>
                <option value="">Seleccionar asignatura</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}
              </Select>
            </Field>
            <div />
            <Field label="Sede" hint="Puedes seleccionar una o más sedes." required className="field--full">
              <div className="selector-header">
                <span>{form.campusIds.length} de {campuses.length} seleccionadas</span>
                <button type="button" onClick={selectAllCampuses}>{form.campusIds.length === campuses.length ? "Quitar todas" : "Seleccionar todas"}</button>
              </div>
              <div className="check-grid">
                {campuses.map((campus) => (
                  <label key={campus.id} className={`check-option ${form.campusIds.includes(campus.id) ? "is-selected" : ""}`}>
                    <input type="checkbox" checked={form.campusIds.includes(campus.id)} onChange={() => toggleCampus(campus.id)} />
                    <span>{campus.name}</span>
                  </label>
                ))}
              </div>
            </Field>
            {form.subjectId && form.campusIds.length > 0 && (
              <Field label="Secciones responsables" hint="Solo estas secciones deberán completar los hitos y contarán en el porcentaje de avance." required className="field--full">
                <div className="selector-header">
                  <span>{form.sectionIds.length} de {availableSections.length} seleccionadas</span>
                  {availableSections.length > 0 && <button type="button" onClick={selectAllSections}>{form.sectionIds.length === availableSections.length ? "Quitar todas" : "Seleccionar todas"}</button>}
                </div>
                {availableSections.length > 0 ? (
                  <div className="check-grid">
                    {availableSections.map((section) => (
                      <label key={section.id} className={`check-option ${form.sectionIds.includes(section.id) ? "is-selected" : ""}`}>
                        <input type="checkbox" checked={form.sectionIds.includes(section.id)} onChange={() => toggleSection(section.id)} />
                        <span>{campusMap.get(section.campusId) || section.campus || "Sede"} · {section.code}{section.schedule || section.shift ? ` · ${section.schedule || section.shift}` : ""}</span>
                      </label>
                    ))}
                  </div>
                ) : <div className="form-error">No existen secciones activas para esta combinación.</div>}
              </Field>
            )}
            <div className="inline-callout field--full">
              <span><Info size={18} /></span>
              <p>Solo los docentes de las secciones responsables podrán ver el proyecto y completar sus hitos.</p>
            </div>
          </div>
        </Card>

        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <Link to="/app"><Button type="button" variant="ghost">Cancelar</Button></Link>
          <Button type="submit" icon={saving ? LoaderCircle : Save} disabled={saving}>{saving ? "Guardando..." : "Guardar propuesta"}</Button>
        </div>
      </form>
    </>
  );
}

function FormSectionHeading({ number, title, description }) {
  return (
    <div className="form-section__heading">
      <span>{number}</span>
      <div><h2>{title}</h2><p>{description}</p></div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
