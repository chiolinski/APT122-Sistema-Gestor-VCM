import { KeyRound, LoaderCircle, ShieldCheck, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { createUser, getUsers, resetUserPassword, setUserActive } from "../services/authApi";
import { Button, Card, Field, Input, PageHeader, Select } from "../components/UI";

const titlesByRole = {
  admin: ["Administrador"],
  coordinator: ["Coordinador CITT", "Director de Carrera"],
  teacher: ["Docente"],
};

const emptyForm = { name: "", email: "", role: "teacher", title: "Docente", teacherSourceId: "", password: "" };

export default function UsersPage() {
  const { session } = useApp();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      setUsers(await getUsers());
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const update = (field, value) => {
    if (field === "role") {
      setForm((current) => ({ ...current, role: value, title: titlesByRole[value][0] }));
      return;
    }
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (form.role === "teacher" && !form.teacherSourceId.trim()) {
      setMessage({ tone: "error", text: "Ingresa el RUT o código académico para vincular la cuenta con sus secciones." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await createUser(form);
      setForm(emptyForm);
      setMessage({ tone: "success", text: "La cuenta fue creada correctamente." });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (user) => {
    setMessage(null);
    try {
      await setUserActive(user.id, !user.active);
      setMessage({ tone: "success", text: user.active ? "La cuenta fue desactivada." : "La cuenta fue activada." });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await resetUserPassword(resetTarget.id, newPassword);
      setResetTarget(null);
      setNewPassword("");
      setMessage({ tone: "success", text: "La contraseña fue actualizada y las sesiones anteriores se cerraron." });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Administración" title="Usuarios" description="Crea las cuentas que participarán en el piloto y controla su acceso." />

      {message && <div className={`notice-banner notice-banner--${message.tone}`} role="status"><ShieldCheck size={20} /><p>{message.text}</p></div>}

      <Card className="form-section user-create-panel">
        <div className="form-section__heading"><span><UserPlus size={18} /></span><div><h2>Nueva cuenta</h2><p>Entrega la contraseña inicial directamente a la persona autorizada.</p></div></div>
        <form className="form-grid form-grid--three" onSubmit={handleCreate}>
          <Field label="Nombre completo" required><Input value={form.name} onChange={(event) => update("name", event.target.value)} required /></Field>
          <Field label="Correo electrónico" required><Input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required /></Field>
          {form.role === "teacher" && <Field label="RUT o código académico" hint="Debe existir en la carga académica" required><Input value={form.teacherSourceId} onChange={(event) => update("teacherSourceId", event.target.value)} placeholder="12.345.678-9" autoComplete="off" required /></Field>}
          <Field label="Contraseña inicial" hint="Mínimo 10 caracteres" required><Input type="password" minLength="10" autoComplete="new-password" value={form.password} onChange={(event) => update("password", event.target.value)} required /></Field>
          <Field label="Rol" required><Select value={form.role} onChange={(event) => update("role", event.target.value)}><option value="admin">Administrador</option><option value="coordinator">Coordinación</option><option value="teacher">Docente</option></Select></Field>
          <Field label="Cargo visible" required><Select value={form.title} onChange={(event) => update("title", event.target.value)}>{titlesByRole[form.role].map((title) => <option key={title}>{title}</option>)}</Select></Field>
          <div className="user-form-action"><Button type="submit" icon={saving ? LoaderCircle : UserPlus} disabled={saving}>{saving ? "Creando..." : "Crear cuenta"}</Button></div>
        </form>
      </Card>

      <Card className="panel-card">
        <div className="card-heading"><div><h2>Cuentas del piloto</h2><p>Las cuentas desactivadas pierden inmediatamente todas sus sesiones.</p></div><span className="record-count"><Users size={14} /> {users.length}</span></div>
        <div className="responsive-table">
          <table>
            <thead><tr><th>Persona</th><th>Rol</th><th>Sede</th><th>Acceso</th><th>Último ingreso</th><th>Acciones</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan="6" className="muted">Cargando usuarios...</td></tr>}
              {!loading && users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong><small>{user.email}</small></td>
                  <td><strong>{user.title}</strong><small>{user.role === "teacher" ? (user.academicLinked ? `Vinculado · ${user.teacherSourceId}` : "Sin vínculo académico") : user.role}</small></td>
                  <td>{user.campuses?.length
                    ? user.campuses.map((campus) => <div key={campus.id}>{campus.name}</div>)
                    : <span className="muted">Sin sede vinculada</span>}</td>
                  <td><span className={`status ${user.active ? "status--finalizado" : ""}`}><span />{user.active ? (user.hasPassword ? "Activo" : "Sin contraseña") : "Desactivado"}</span></td>
                  <td>{user.lastAccessAt ? new Date(user.lastAccessAt).toLocaleString("es-CL") : <span className="muted">Sin ingresos</span>}</td>
                  <td><div className="table-icon-actions">
                    <button className="icon-button" onClick={() => { setResetTarget(user); setNewPassword(""); }} disabled={user.id === session.id} aria-label={`Cambiar contraseña de ${user.name}`} title={user.id === session.id ? "Usa Mi cuenta" : "Cambiar contraseña"}><KeyRound size={17} /></button>
                    <button className="icon-button" onClick={() => handleStatus(user)} disabled={user.id === session.id} aria-label={user.active ? `Desactivar a ${user.name}` : `Activar a ${user.name}`} title={user.active ? "Desactivar cuenta" : "Activar cuenta"}>{user.active ? <UserX size={17} /> : <UserCheck size={17} />}</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {resetTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setResetTarget(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal__icon"><KeyRound size={22} /></span>
            <h2 id="password-dialog-title">Nueva contraseña</h2>
            <p>Actualizarás el acceso de <strong>{resetTarget.name}</strong> y cerrarás sus sesiones actuales.</p>
            <form onSubmit={handleReset}>
              <Field label="Contraseña nueva" hint="Mínimo 10 caracteres" required><Input type="password" minLength="10" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoFocus required /></Field>
              <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>Cancelar</Button><Button type="submit" icon={KeyRound} disabled={saving}>Actualizar</Button></div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
