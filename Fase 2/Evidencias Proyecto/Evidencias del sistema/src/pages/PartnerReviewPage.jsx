import { ArrowLeft, ArrowRight, Check, CheckCircle2, LockKeyhole, MessageSquareText, Star, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, Field, Textarea } from "../components/UI";
import PartnerReviewVideo from "../components/PartnerReviewVideo";
import ReviewFinishDialog from "../components/ReviewFinishDialog";
import { completePartnerReview, getPartnerReview, savePartnerEvaluation } from "../services/partnerReviewApi";
import "./partnerReview.css";

const EMPTY = { strengths: "", improvements: "", rating: 0 };
const RATING_LABELS = ["", "Muy baja", "Baja", "Media", "Alta", "Muy alta"];
const formatDate = (value) => value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value)) : "";

function demoReview() {
  return {
    id: "demo", partnerName: "Socio ficticio local", contactName: "Contacto ficticio",
    projectName: "Soluciones digitales para la comunidad", subjectName: "Desarrollo de aplicaciones móviles",
    campusName: "Sede ficticia 01", sectionCode: "001D", teacherName: "Docente ficticio 01", period: "2026-2",
    reviewDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date()),
    teams: [1, 2, 3].map((number) => ({ id: `demo-${number}`, name: `Equipo ${number}`, videoUrl: null })),
    evaluations: [], completedAt: null,
  };
}

export default function PartnerReviewPage() {
  const location = useLocation();
  const demo = import.meta.env.DEV && location.pathname === "/revision-socio/demo";
  // El secreto viaja en el fragmento del enlace y en un encabezado propio, nunca en la URL de la API.
  const token = location.hash.slice(1);
  return <ReviewSession key={`${demo}:${token}`} token={token} demo={demo} />;
}

function ReviewSession({ token, demo }) {
  const [review, setReview] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [summary, setSummary] = useState(false);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const headingRef = useRef(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    (demo ? Promise.resolve(demoReview()) : token
      ? getPartnerReview(token)
      : Promise.reject(new Error("El enlace está incompleto. Abre el enlace completo que te envió la coordinación.")))
      .then((data) => {
        if (!active) return;
        setReview(data);
        setDrafts(Object.fromEntries(data.evaluations.map((item) => [item.teamId, item])));
        const pending = data.teams.findIndex((team) => !data.evaluations.some((item) => item.teamId === team.id));
        setIndex(pending < 0 ? 0 : pending);
        setSummary(Boolean(data.completedAt) || (data.teams.length > 0 && pending < 0));
      })
      .catch((failure) => { if (active) setLoadError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, demo, reload]);

  const hasUnsaved = Boolean(review && Object.entries(drafts).some(([teamId, draft]) => {
    const saved = review.evaluations.find((item) => item.teamId === teamId) || EMPTY;
    return ["strengths", "improvements", "rating"].some((key) => draft[key] !== saved[key]);
  }));

  useEffect(() => {
    if (!hasUnsaved) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  const moveTo = (nextIndex) => {
    setIndex(nextIndex); setSummary(false); setError(""); setNotice("");
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving || review.completedAt) return;
    const team = review.teams[index];
    const draft = drafts[team.id] || EMPTY;
    if (!draft.strengths.trim() || !draft.improvements.trim() || !draft.rating) {
      setError("Completa ambos comentarios y selecciona una valoración de 1 a 5 estrellas.");
      return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const saved = demo ? { ...draft, strengths: draft.strengths.trim(), improvements: draft.improvements.trim(), teamId: team.id, reviewedAt: new Date().toISOString() }
        : await savePartnerEvaluation(token, team.id, draft);
      setReview((current) => ({ ...current, evaluations: [...current.evaluations.filter((item) => item.teamId !== team.id), saved] }));
      setDrafts((current) => ({ ...current, [team.id]: saved }));
      setNotice(`Evaluación de ${team.name} guardada${demo ? " en esta demostración" : ""}.`);
      if (index < review.teams.length - 1) {
        setIndex(index + 1);
      } else {
        setSummary(true);
      }
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };

  const finish = async () => {
    if (!confirmingFinish || finishingRef.current || saving || review.completedAt || !allSaved || hasUnsaved) return;
    finishingRef.current = true;
    setSaving(true); setError("");
    try {
      const result = demo ? { completedAt: new Date().toISOString() } : await completePartnerReview(token);
      setReview((current) => ({ ...current, ...result }));
      setConfirmingFinish(false);
      setNotice("");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (failure) { setError(failure.message); }
    finally { finishingRef.current = false; setSaving(false); }
  };

  const team = review?.teams[index];
  const draft = drafts[team?.id] || EMPTY;
  const saved = review?.evaluations.find((item) => item.teamId === team?.id);
  const isDirty = ["strengths", "improvements", "rating"].some((key) => draft[key] !== (saved || EMPTY)[key]);
  const update = (key, value) => { setDrafts((current) => ({ ...current, [team.id]: { ...(current[team.id] || EMPTY), [key]: value } })); setError(""); setNotice(""); };
  const completed = Boolean(review?.completedAt);
  const count = review?.evaluations.length || 0;
  const allSaved = Boolean(review?.teams.length && review.teams.every((item) => review.evaluations.some((evaluation) => evaluation.teamId === item.id)));

  return (
    <div className="partner-review">
      <button className="review-skip" type="button" onClick={() => document.getElementById("review-main")?.focus()}>Ir al contenido de la revisión</button>
      <header className="review-header">
        <div className="review-header__inner">
          <img src="/brand/citt-duocuc-color.png" alt="CITT Duoc UC" width="1642" height="596" />
          <span>Vinculación con el Medio <strong>2026-2</strong></span>
          <span className="review-private"><LockKeyhole size={15} /> Acceso por enlace</span>
        </div>
      </header>
      <main id="review-main" className="review-content" tabIndex={-1}>
        {demo && <div className="review-demo" role="note">Vista de demostración · Socio y docente de ejemplo. Los equipos 1, 2 y 3 muestran los videos de prueba de la sección 001D de Concepción. Las respuestas sólo duran mientras esta página permanezca abierta.</div>}
        {loading ? <div className="review-message" role="status">Cargando tu revisión…</div> : loadError ? (
          <section className="review-message"><LockKeyhole size={36} /><h1>No pudimos abrir la revisión</h1><p role="alert">{loadError}</p><Button onClick={() => setReload((value) => value + 1)}>Intentar nuevamente</Button></section>
        ) : review && <>
          <div className="review-intro"><div><h1>Revisión de avances</h1><p>Tu experiencia nos ayuda a mejorar las soluciones de nuestros estudiantes.</p></div><span className="review-period">Socio formador</span></div>
          <section className="review-context" aria-label="Datos de la revisión">
            <div className="review-partner"><span>Socio formador</span><strong>{review.partnerName}</strong>{review.contactName && <small>{review.contactName}</small>}</div>
            <dl><div><dt>Sede</dt><dd>{review.campusName}</dd></div><div><dt>Sección</dt><dd>{review.sectionCode}</dd></div><div><dt>Docente a cargo</dt><dd>{review.teacherName || "Por asignar"}</dd></div><div><dt>{completed ? "Revisión finalizada" : "Fecha de revisión"}</dt><dd>{formatDate(completed ? review.completedAt : review.reviewDate)}</dd></div></dl>
          </section>
          <div className="review-project"><strong>{review.projectName}</strong><span>{review.subjectName}</span></div>
          <section className="review-progress" aria-label="Progreso de la revisión">
            <div><strong>{completed ? review.closedInternally ? "Revisión cerrada por la plataforma" : "Revisión completada" : `${count} de ${review.teams.length} equipos evaluados`}</strong><span>{completed ? `${count} de ${review.teams.length} equipos evaluados · Gracias por tu aporte` : "Puedes guardar y retomar desde este mismo enlace durante un máximo de 21 días desde su creación."}</span></div>
            <progress value={count} max={Math.max(review.teams.length, 1)} aria-label="Equipos evaluados" />
          </section>
          <div className="review-notices" aria-live="polite">{notice && <p className="review-success"><CheckCircle2 size={18} />{notice}</p>}</div>
          {error && !confirmingFinish && <p className="review-error" role="alert">{error}</p>}
          {!review.teams.length ? <section className="review-message"><h2>Aún no hay equipos disponibles</h2><p>La coordinación debe preparar los equipos de esta revisión.</p></section> : summary ? (
            <section className="review-summary">
              {completed && <CheckCircle2 className="review-summary__check" size={46} />}
              <h2 tabIndex={-1} ref={headingRef}>{completed ? "Tu revisión quedó registrada" : "Revisa tus evaluaciones"}</h2>
              <p>{completed ? review.closedInternally ? "El docente o la coordinación cerró esta revisión con las respuestas guardadas. Ya no admite cambios ni nuevas evaluaciones. Los equipos sin evaluar no reciben una valoración." : "Gracias por compartir tus observaciones. La coordinación podrá consultarlas para acompañar a los estudiantes." : "Puedes volver a cada equipo para ajustar tus comentarios antes de finalizar."}</p>
              <ul>{review.teams.map((item, itemIndex) => {
                const evaluation = review.evaluations.find((entry) => entry.teamId === item.id);
                const itemDraft = drafts[item.id];
                const dirty = itemDraft && ["strengths", "improvements", "rating"].some((key) => itemDraft[key] !== (evaluation || EMPTY)[key]);
                return <li key={item.id}><span><strong>{item.name}</strong><small>{dirty ? "Cambios sin guardar" : evaluation ? `${evaluation.rating} de 5 estrellas · Guardada` : completed ? "Sin evaluar" : "Pendiente de evaluación"}</small></span><Button variant="secondary" disabled={saving || (completed && !evaluation)} onClick={() => moveTo(itemIndex)}>{completed ? evaluation ? "Ver evaluación" : "Sin evaluación" : evaluation ? "Editar" : "Evaluar"}</Button></li>;
              })}</ul>
              {!completed && <Button icon={Check} disabled={saving || !allSaved || hasUnsaved} onClick={() => { setError(""); setConfirmingFinish(true); }}>Finalizar revisión</Button>}
              {!completed && hasUnsaved && <p className="review-help">Guarda los cambios pendientes de cada equipo antes de finalizar.</p>}
            </section>
          ) : <>
            <div className="review-team-heading"><div><span>Equipo {index + 1} de {review.teams.length}</span><h2 ref={headingRef} tabIndex={-1}>{team.name}</h2></div>{saved && !isDirty && <span className="review-saved"><CheckCircle2 size={16} /> Evaluación guardada</span>}</div>
            <div className="review-workspace">
              <section className="review-video-panel" aria-label={`Video demostrativo de ${team.name}`}>
                <PartnerReviewVideo key={team.id} team={team} token={token} demo={demo} />
                <div className="review-video-caption"><Video size={18} /><div><strong>Propuesta de solución</strong><p>Observa la presentación del equipo y comparte tu evaluación.</p></div></div>
                <aside className="review-guidance"><MessageSquareText size={22} /><div><h3>Una mirada desde tu experiencia</h3><p>Considera la utilidad de la propuesta para tu organización, sus fortalezas y las oportunidades para mejorarla.</p></div></aside>
              </section>
              <form className="review-form" onSubmit={save}>
                <h3>Evaluación del equipo</h3>
                <Field label="Fortalezas observadas de la propuesta de solución" required><Textarea name="strengths" autoComplete="off" value={draft.strengths} onChange={(event) => update("strengths", event.target.value)} placeholder="¿Qué aspectos de la propuesta destacarías?" required maxLength={4000} rows={4} disabled={saving || completed} /></Field>
                <Field label="Observaciones / propuestas de mejora" required><Textarea name="improvements" autoComplete="off" value={draft.improvements} onChange={(event) => update("improvements", event.target.value)} placeholder="¿Qué podría ajustar o mejorar el equipo?" required maxLength={4000} rows={4} disabled={saving || completed} /></Field>
                <fieldset className="review-rating" disabled={saving || completed}>
                  <legend>Valoración de la propuesta <span aria-hidden="true">*</span></legend>
                  <div>{[1, 2, 3, 4, 5].map((rating) => <label key={rating} className={draft.rating >= rating ? "is-filled" : ""}><input type="radio" name={`rating-${team.id}`} value={rating} checked={draft.rating === rating} onChange={() => update("rating", rating)} required aria-label={`${rating} ${rating === 1 ? "estrella" : "estrellas"}`} /><Star size={30} strokeWidth={1.7} aria-hidden="true" /></label>)}<span>{draft.rating ? `${draft.rating}/5 · ${RATING_LABELS[draft.rating]}` : "Selecciona de 1 a 5"}</span></div>
                </fieldset>
                {completed ? <p className="review-help">La revisión finalizada está disponible para consulta.</p> : <><p className="review-help">Todos los campos son obligatorios. Si no tienes sugerencias, puedes indicarlo en observaciones.</p><div className="review-submit"><span>{isDirty ? "Cambios sin guardar" : saved ? `Guardado el ${formatDate(saved.reviewedAt)}` : "Evaluación pendiente"}</span><Button type="submit" icon={ArrowRight} disabled={saving}>{saving ? "Guardando…" : index === review.teams.length - 1 ? "Guardar y revisar resumen" : "Guardar y continuar"}</Button></div></>}
              </form>
            </div>
            <nav className="review-navigation" aria-label="Navegación entre equipos"><Button variant="secondary" icon={ArrowLeft} disabled={index === 0 || saving} onClick={() => moveTo(index - 1)}>Equipo anterior</Button><Button variant="secondary" disabled={saving} onClick={() => { setSummary(true); setError(""); requestAnimationFrame(() => headingRef.current?.focus()); }}>{completed ? "Volver al resumen" : "Ver resumen"}</Button></nav>
          </>}
        </>}
      </main>
      <footer className="review-footer">CITT · Duoc UC <span>Vinculación con el Medio 2026-2</span></footer>
      {confirmingFinish && <ReviewFinishDialog saving={saving} error={error} onCancel={() => { if (!saving) { setConfirmingFinish(false); setError(""); } }} onConfirm={finish} />}
    </div>
  );
}
