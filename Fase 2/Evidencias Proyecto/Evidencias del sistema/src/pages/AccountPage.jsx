import {
  BookOpenCheck,
  Clock3,
  KeyRound,
  Layers3,
  LoaderCircle,
  Mail,
  MapPin,
  ShieldCheck,
  School,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { changePassword, getAccountProfile } from "../services/authApi";
import { Button, Card, Field, Input, PageHeader } from "../components/UI";

const ROLE_LABELS = {
  admin: "Administrador",
  coordinator: "Coordinador CITT",
  teacher: "Docente",
};

function ProfileField({ icon: Icon, label, value }) {
  return (
    <div className="account-profile-field">
      <span><Icon size={17} /></span>
      <div><small>{label}</small><strong>{value || "No registrado"}</strong></div>
    </div>
  );
}

function AcademicProfile({ academic, loading }) {
  if (loading) {
    return <div className="account-profile-loading"><LoaderCircle size={21} /> Cargando vinculación académica...</div>;
  }

  if (!academic?.linked) {
    return (
      <div className="account-profile-empty">
        <BookOpenCheck size={23} />
        <div><strong>Sin vinculación académica</strong><p>Esta cuenta no tiene asignaturas ni secciones vigentes asociadas.</p></div>
      </div>
    );
  }

  return (
    <>
      <div className="account-academic-summary">
        <div><span><MapPin size={17} /></span><strong>{academic.totals.campuses}</strong><small>Sedes</small></div>
        <div><span><School size={17} /></span><strong>{academic.totals.schools}</strong><small>Escuelas</small></div>
        <div><span><BookOpenCheck size={17} /></span><strong>{academic.totals.subjects}</strong><small>Asignaturas</small></div>
        <div><span><Layers3 size={17} /></span><strong>{academic.totals.sections}</strong><small>Secciones</small></div>
      </div>

      <div className="account-campus-list">
        <strong>Sedes asociadas</strong>
        <div>{academic.campuses.map((campus) => <span key={campus.id}><MapPin size={13} />{campus.name}</span>)}</div>
      </div>

      <div className="account-school-list">
        <strong>Escuelas asociadas</strong>
        <div>{academic.schools.map((school) => <span key={school.id}><School size={13} />{school.name}</span>)}</div>
      </div>

      <div className="account-subject-list">
        {academic.subjects.map((subject) => (
          <article className="account-subject" key={subject.id}>
            <div className="account-subject__heading">
              <span><BookOpenCheck size={17} /></span>
              <div><small>{subject.code}</small><strong>{subject.name}</strong>{subject.school && <p>{subject.school.name}</p>}</div>
              <b>{subject.sections.length} {subject.sections.length === 1 ? "sección" : "secciones"}</b>
            </div>
            <div className="account-section-list">
              {subject.sections.map((section) => (
                <div key={section.id}>
                  <strong>{section.code}</strong>
                  <span><MapPin size={12} />{section.campus.name}</span>
                  {section.shift && <span><Clock3 size={12} />{section.shift}</span>}
                  <small>{section.period}</small>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export default function AccountPage() {
  const { session } = useApp();
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;
    getAccountProfile()
      .then((nextProfile) => { if (active) setProfile(nextProfile); })
      .catch((error) => { if (active) setProfileError(error.message); })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [session.id]);

  const visibleProfile = profile || session;
  const campusSummary = profileLoading ? "Cargando..." : profile?.academic?.campuses.map((campus) => campus.name).join(", ") || "Sin sede asociada";
  const schoolSummary = profileLoading ? "Cargando..." : profile?.academic?.schools.map((school) => school.name).join(", ") || "Sin escuela registrada";
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage(null);
    if (form.newPassword !== form.confirmPassword) {
      setMessage({ tone: "error", text: "Las contraseñas nuevas no coinciden." });
      return;
    }
    setSaving(true);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage({ tone: "success", text: "Tu contraseña fue actualizada correctamente." });
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Cuenta personal" title="Mi cuenta" description="Consulta tu información de acceso y tu vinculación académica vigente." />
      {message && <div className={`notice-banner notice-banner--${message.tone}`} role="status"><ShieldCheck size={20} /><p>{message.text}</p></div>}
      {profileError && <div className="notice-banner notice-banner--error" role="alert"><ShieldCheck size={20} /><p>{profileError}</p></div>}

      <div className="account-layout">
        <Card className="account-profile-card">
          <div className="account-profile-hero">
            <span className="account-profile-avatar">{visibleProfile.initials || visibleProfile.name?.slice(0, 2).toUpperCase()}</span>
            <div><p className="eyebrow">Perfil de usuario</p><h2>{visibleProfile.name}</h2><span>{visibleProfile.title}</span></div>
          </div>

          <div className="account-profile-fields">
            <ProfileField icon={Mail} label="Correo institucional" value={visibleProfile.email} />
            <ProfileField icon={ShieldCheck} label="Rol de acceso" value={ROLE_LABELS[visibleProfile.role]} />
            <ProfileField icon={UserRound} label="Cargo visible" value={visibleProfile.title} />
            <ProfileField icon={MapPin} label="Sede" value={campusSummary} />
            <ProfileField icon={School} label="Escuela" value={schoolSummary} />
          </div>

          <div className="account-academic-heading">
            <div><p className="eyebrow">Resumen académico</p><h3>Asignaturas y secciones asociadas</h3></div>
            {profile?.academic?.linked && <span>Vinculación vigente</span>}
          </div>
          <AcademicProfile academic={profile?.academic} loading={profileLoading} />
        </Card>

        <Card className="form-section account-security-panel">
          <div className="form-section__heading"><span><KeyRound size={18} /></span><div><h2>Cambiar contraseña</h2><p>Al actualizarla, las demás sesiones abiertas se cerrarán.</p></div></div>
          <form className="form-stack" onSubmit={handleSubmit}>
            <Field label="Contraseña actual" required><Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => update("currentPassword", event.target.value)} required /></Field>
            <Field label="Contraseña nueva" hint="Mínimo 10 caracteres" required><Input type="password" minLength="10" autoComplete="new-password" value={form.newPassword} onChange={(event) => update("newPassword", event.target.value)} required /></Field>
            <Field label="Repite la contraseña nueva" required><Input type="password" minLength="10" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} required /></Field>
            <div className="form-actions"><Button type="submit" icon={saving ? LoaderCircle : KeyRound} disabled={saving}>{saving ? "Actualizando..." : "Actualizar contraseña"}</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
