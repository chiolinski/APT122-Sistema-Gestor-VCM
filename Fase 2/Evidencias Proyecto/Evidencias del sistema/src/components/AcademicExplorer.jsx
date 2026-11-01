import { BookOpen, Building2, ChevronLeft, ChevronRight, FileSpreadsheet, GraduationCap, LoaderCircle, Pencil, Save, School, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAcademicRecords, updateAcademicRecord } from "../services/academicApi";
import { Button, Card, Field, Input, SearchInput, Select } from "./UI";

const ENTITY_CONFIG = {
  campuses: {
    label: "Sedes", singular: "sede", icon: Building2, search: "Buscar por código o nombre",
    columns: [
      { key: "code", label: "Código" }, { key: "name", label: "Nombre" },
      { key: "sections", label: "Secciones" }, { key: "active", label: "Estado", type: "status" },
    ],
    fields: [{ key: "code", label: "Código" }, { key: "name", label: "Nombre" }],
  },
  schools: {
    label: "Escuelas", singular: "escuela", icon: School, search: "Buscar por nombre de escuela",
    columns: [
      { key: "name", label: "Nombre" }, { key: "subjects", label: "Asignaturas" },
      { key: "active", label: "Estado", type: "status" },
    ],
    fields: [{ key: "name", label: "Nombre" }],
  },
  subjects: {
    label: "Asignaturas", singular: "asignatura", icon: BookOpen, search: "Buscar por código, nombre o escuela",
    columns: [
      { key: "code", label: "Código" }, { key: "name", label: "Nombre" },
      { key: "schoolName", label: "Escuela" },
      { key: "sections", label: "Secciones" }, { key: "students", label: "Estudiantes" },
      { key: "active", label: "Estado", type: "status" },
    ],
    fields: [{ key: "code", label: "Código" }, { key: "name", label: "Nombre" }, { key: "schoolName", label: "Escuela", optional: true }],
  },
  sections: {
    label: "Secciones", singular: "sección", icon: School, search: "Buscar por sección, asignatura, sede o período",
    columns: [
      { key: "code", label: "Sección" }, { key: "subjectCode", label: "Asignatura", detail: "subjectName" },
      { key: "campusName", label: "Sede" }, { key: "period", label: "Período" },
      { key: "shift", label: "Jornada" }, { key: "students", label: "Estudiantes" },
      { key: "teacherNames", label: "Docentes" }, { key: "active", label: "Estado", type: "status" },
    ],
    fields: [{ key: "code", label: "Código de sección" }, { key: "shift", label: "Jornada", optional: true }],
  },
  teachers: {
    label: "Docentes", singular: "docente", icon: GraduationCap, search: "Buscar por RUT, nombre o correo",
    columns: [
      { key: "sourceId", label: "RUT / código" }, { key: "name", label: "Nombre" },
      { key: "email", label: "Correo" }, { key: "userEmail", label: "Cuenta vinculada" },
      { key: "subjects", label: "Asignaturas" }, { key: "sections", label: "Secciones" },
      { key: "active", label: "Estado", type: "status" },
    ],
    fields: [
      { key: "sourceId", label: "RUT o código académico" }, { key: "name", label: "Nombre completo" },
      { key: "email", label: "Correo", type: "email", optional: true },
    ],
  },
  students: {
    label: "Estudiantes", singular: "estudiante", icon: Users, search: "Buscar por RUT, nombre o correo",
    columns: [
      { key: "rut", label: "RUT" }, { key: "name", label: "Nombre" }, { key: "email", label: "Correo" },
      { key: "enrollments", label: "Matrículas" }, { key: "enrollmentDetails", label: "Asignatura / sección / sede" },
      { key: "active", label: "Estado", type: "status" },
    ],
    fields: [
      { key: "sourceId", label: "Identificador externo", optional: true }, { key: "rut", label: "RUT" },
      { key: "name", label: "Nombre completo" }, { key: "email", label: "Correo", type: "email", optional: true },
    ],
  },
};

const ENTITY_ORDER = ["campuses", "schools", "subjects", "sections", "teachers", "students"];

export default function AcademicExplorer() {
  const [entity, setEntity] = useState("campuses");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ records: [], counts: {}, total: 0, pageSize: 25 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async (selectedEntity = entity, selectedQuery = query, selectedPage = page) => {
    setLoading(true);
    try {
      setData(await getAcademicRecords(selectedEntity, selectedQuery, selectedPage));
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { load(entity, query, page); }, 250);
    return () => clearTimeout(timer);
    // load depende deliberadamente del estado que se entrega como argumento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, query, page]);

  const selectEntity = (nextEntity) => {
    setEntity(nextEntity);
    setQuery("");
    setPage(1);
    setEditing(null);
  };

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const config = ENTITY_CONFIG[entity];

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateAcademicRecord(entity, editing.id, editing);
      setEditing(null);
      setMessage({ tone: "success", text: `La ${config.singular} fue actualizada correctamente.` });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {message && <div className={`notice-banner notice-banner--${message.tone}`} role="status"><FileSpreadsheet size={20} /><p>{message.text}</p><button onClick={() => setMessage(null)}>×</button></div>}

      <div className="academic-entity-grid" role="tablist" aria-label="Tipos de datos académicos">
        {ENTITY_ORDER.map((key) => {
          const item = ENTITY_CONFIG[key];
          const Icon = item.icon;
          return (
            <button key={key} type="button" role="tab" aria-selected={entity === key} className={`academic-entity-card ${entity === key ? "is-active" : ""}`} onClick={() => selectEntity(key)}>
              <span><Icon size={19} /></span><div><strong>{item.label}</strong><small>{data.counts[key] ?? "—"} registros</small></div>
            </button>
          );
        })}
      </div>

      <Card className="panel-card academic-record-panel">
        <div className="card-heading"><div><p className="eyebrow">Base académica</p><h2>{config.label}</h2><p>Consulta la información almacenada y corrige manualmente datos puntuales cuando sea necesario.</p></div><span className="record-count">{data.total} resultados</span></div>
        <div className="toolbar"><SearchInput value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={config.search} /><span>Página {page} de {totalPages}</span></div>
        <div className="responsive-table academic-record-table">
          <table>
            <thead><tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}<th>Acción</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={config.columns.length + 1} className="academic-loading"><LoaderCircle size={17} /> Cargando información...</td></tr>}
              {!loading && data.records.length === 0 && <tr><td colSpan={config.columns.length + 1} className="muted">No se encontraron registros.</td></tr>}
              {!loading && data.records.map((record) => (
                <tr key={record.id}>
                  {config.columns.map((column) => <AcademicCell key={column.key} record={record} column={column} />)}
                  <td><button className="icon-button" type="button" onClick={() => setEditing({ ...record })} aria-label={`Editar ${record.name || record.code || record.rut}`} title="Editar registro"><Pencil size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="academic-pagination">
          <Button variant="secondary" icon={ChevronLeft} disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
          <span>{Math.min((page - 1) * data.pageSize + 1, data.total || 0)}–{Math.min(page * data.pageSize, data.total)} de {data.total}</span>
          <Button variant="secondary" icon={ChevronRight} disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
        </div>
      </Card>

      {editing && <AcademicEditModal entity={entity} config={config} record={editing} saving={saving} onChange={setEditing} onClose={() => setEditing(null)} onSave={handleSave} />}
    </>
  );
}

function AcademicCell({ record, column }) {
  if (column.type === "status") {
    return <td><span className={`status ${record[column.key] ? "status--finalizado" : ""}`}><span />{record[column.key] ? "Activo" : "Inactivo"}</span></td>;
  }
  const value = record[column.key];
  return <td><strong>{value ?? "—"}</strong>{column.detail && record[column.detail] && <small>{record[column.detail]}</small>}</td>;
}

function AcademicEditModal({ entity, config, record, saving, onChange, onClose, onSave }) {
  const title = useMemo(() => record.name || record.code || record.rut || config.singular, [config.singular, record]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal academic-edit-modal" role="dialog" aria-modal="true" aria-labelledby="academic-edit-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <span className="modal__icon"><Pencil size={21} /></span>
        <h2 id="academic-edit-title">Editar {config.singular}</h2>
        <p>{title}. Los cambios se aplicarán directamente en la base académica.</p>
        <form onSubmit={onSave}>
          <div className="form-grid">
            {config.fields.map((field) => (
              <Field key={field.key} label={field.label} required={!field.optional}>
                <Input type={field.type || "text"} value={record[field.key] || ""} onChange={(event) => onChange({ ...record, [field.key]: event.target.value })} required={!field.optional} />
              </Field>
            ))}
            <Field label="Estado" required>
              <Select value={record.active ? "active" : "inactive"} onChange={(event) => onChange({ ...record, active: event.target.value === "active" })}>
                <option value="active">Activo</option><option value="inactive">Inactivo</option>
              </Select>
            </Field>
            {entity === "sections" && <div className="record-structure-note"><School size={17} /><p>La asignatura, sede y período se mantienen protegidos para conservar la integridad de matrículas y proyectos.</p></div>}
          </div>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" icon={saving ? LoaderCircle : Save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button></div>
        </form>
      </section>
    </div>
  );
}
