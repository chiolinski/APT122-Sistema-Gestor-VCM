import { CheckCircle2, Copy, RefreshCw, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Textarea } from "./UI";
import ReviewFinishDialog from "./ReviewFinishDialog";
import ClosePartnerReviewButton from "./ClosePartnerReviewButton";
import { createVideoDeliveryLinks, getHitoTwoState, publishHitoTwoVideos } from "../services/partnerReviewApi";
import "./hitoTwo.css";

const date = (value) => value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(new Date(value)) : "";
const videoStatus = { available: "Video disponible", pending: "Video pendiente", unassigned: "Revisar nombre del equipo", error: "No se pudo comprobar el video" };

export default function HitoTwoPanel({ projectId, section, closed, progress, setProgress, saving, onSubmit }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState([]);
  const [reviewLink, setReviewLink] = useState("");
  const [notice, setNotice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reload, setReload] = useState(0);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const publishingRef = useRef(false);
  const [closingReviewId, setClosingReviewId] = useState(null);
  const [closeError, setCloseError] = useState("");
  const [submittingClose, setSubmittingClose] = useState(false);
  const closingRef = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setAcknowledged(false);
    setPublishDialogOpen(false); setPublishError("");
    setClosingReviewId(null); setCloseError("");
    getHitoTwoState(projectId, section.id).then((data) => { if (active) setState(data); })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, section.id, closed, reload]);

  const createLinks = async () => {
    if (busy || !window.confirm("¿Crear enlaces de entrega para los equipos de esta sección? Si ya tenían enlaces, dejarán de funcionar; los videos confirmados se conservarán.")) return;
    setBusy(true); setError("");
    try { setLinks(await createVideoDeliveryLinks(projectId, section.id)); setNotice("Comparte cada enlace sólo con su equipo. Guárdalos antes de salir: se muestran una sola vez."); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const requestPublish = () => {
    if (busy || saving || loading || error || closed || !state?.canPublish || state.review) return;
    setPublishError(""); setPublishDialogOpen(true);
  };
  const publish = async () => {
    if (publishingRef.current || !publishDialogOpen || busy || saving || loading || error || closed || !state?.canPublish || state.review) return;
    publishingRef.current = true;
    setBusy(true); setPublishError("");
    try {
      const result = await publishHitoTwoVideos(projectId, section.id);
      setReviewLink(`${window.location.origin}/revision-socio#${result.token}`);
      setLinks([]); setNotice("Entrega registrada. Comparte el enlace de evaluación con el socio formador.");
      setPublishDialogOpen(false);
      setReload((value) => value + 1);
    } catch (failure) { setPublishError(failure.message || "No se pudo registrar la entrega. Intenta nuevamente."); }
    finally { publishingRef.current = false; setBusy(false); }
  };
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); setNotice("Enlace copiado."); }
    catch { setNotice("Selecciona el enlace y cópialo manualmente."); }
  };
  const submit = (event) => {
    event.preventDefault();
    if (!acknowledged || !state?.feedbackReady || busy || saving || submittingClose || loading || error || closed) return;
    if (!progress.advance?.trim() || !progress.conclusions?.trim()) return;
    setCloseError(""); setClosingReviewId(state.review.id);
  };
  const confirmClose = async (event) => {
    if (closingRef.current || !closingReviewId || !acknowledged || !state?.feedbackReady || busy || saving || loading || error || closed) return;
    if (closingReviewId !== state.review?.id) {
      setCloseError("La revisión cambió. Vuelve al resumen y revisa la retroalimentación vigente antes de cerrar.");
      return;
    }
    closingRef.current = true;
    setSubmittingClose(true); setCloseError("");
    try {
      const result = await onSubmit(event, closingReviewId);
      if (result === false) setCloseError("No se pudo cerrar el Hito 2. Revisa el avance y las conclusiones e intenta nuevamente.");
      else setClosingReviewId(null);
    } catch (failure) {
      setCloseError(failure.message || "No se pudo cerrar el Hito 2. Intenta nuevamente.");
    } finally {
      closingRef.current = false;
      setSubmittingClose(false);
    }
  };
  const locked = busy || saving || submittingClose || loading || Boolean(error);
  const review = state?.review;
  const average = review?.evaluations.length ? (review.evaluations.reduce((sum, item) => sum + item.rating, 0) / review.evaluations.length).toFixed(1) : null;
  return <Card className="panel-card hito-two">
    <div className="card-heading"><div><h2>Hito 2 · Sección {section.code}</h2><p>Entrega de videos, retroalimentación del socio y cierre docente.</p></div>
      <Button type="button" variant="secondary" icon={RefreshCw} disabled={busy || saving || submittingClose || loading} onClick={() => setReload((value) => value + 1)}>Actualizar estado</Button></div>
    {loading && <p role="status">Consultando el Hito 2…</p>}
    {error && <p role="alert" className="hito-two__error">{error}</p>}
    <div aria-live="polite">{notice && <p className="hito-two__notice">{notice}</p>}</div>
    {state && <>
      <ol className="hito-two__phases" aria-label="Fases del Hito 2">
        <li aria-current={!review && !closed ? "step" : undefined}><span>1</span><div><strong>Videos y retroalimentación</strong><small>{review ? `${review.evaluatedCount}/${review.teams.length} equipos evaluados` : "Preparar entregas de los equipos"}</small></div></li>
        <li aria-current={review && !closed ? "step" : undefined}><span>{closed ? <CheckCircle2 size={20} aria-hidden="true" /> : "2"}</span><div><strong>Revisión y cierre docente</strong><small>{closed ? "Hito 2 cerrado" : state.feedbackReady ? "Resumen disponible" : "En espera de la retroalimentación final"}</small></div></li>
      </ol>
      {!closed && <section className="hito-two__phase" aria-label="Entrega de videos">
        <h3><Video size={19} aria-hidden="true" /> Videos de los equipos</h3>
        {state.videos.length ? <ul className="hito-two__videos">{state.videos.map((video) => <li key={video.id}><strong>{video.name}</strong><span>{videoStatus[video.status]}</span></li>)}</ul>
          : <p>Conforma equipos con integrantes antes de preparar las entregas.</p>}
        {state.canReceiveVideos && <><p>Sube los videos de tus equipos al almacenamiento mediante el enlace facilitado por dirección, en la carpeta correspondiente a esta sede, asignatura y sección. Usa nombres como <code>Videoequipo1.mp4</code>, <code>Videoequipo2.mp4</code>, etc., respetando mayúsculas y minúsculas. Después pulsa «Actualizar estado».</p>
          {state.uploadEnabled === true && <><p>También está habilitada la entrega directa de alumnos mediante enlaces por equipo (MP4, máximo 200 MB).</p>
            <Button type="button" variant="secondary" disabled={locked || !state.videos.length} onClick={createLinks}>Crear o renovar enlaces de entrega</Button></>}
        </>}
        {links.map((link) => <div className="hito-two__link" key={link.teamId}><label htmlFor={`delivery-${link.teamId}`}>Enlace de entrega · {link.teamName}</label>
          <input id={`delivery-${link.teamId}`} className="control" readOnly value={`${window.location.origin}/entrega-video#${link.token}`} onFocus={(event) => event.target.select()} />
          <Button type="button" variant="secondary" icon={Copy} onClick={() => copy(`${window.location.origin}/entrega-video#${link.token}`)}>Copiar enlace de {link.teamName}</Button></div>)}
        {!review && <Button type="button" disabled={locked || !state.canPublish} onClick={requestPublish}>Registrar videos y solicitar retroalimentación</Button>}
        {review && <p>Entrega registrada el {date(review.deliveredAt)}. {review.completedAt
          ? review.closedInternally ? review.evaluatedCount ? "La revisión se cerró internamente con las evaluaciones guardadas." : "Cerrada sin respuestas. Este cierre no habilita el cierre del Hito 2. Solicita una nueva revisión a coordinación." : "El socio formador finalizó su revisión."
          : "La revisión aún no ha finalizado. El socio puede completarla o puedes cerrarla con al menos una evaluación guardada. Esto no cierra el Hito 2."}</p>}
        {review && !review.completedAt && <p>El enlace permite evaluar durante un máximo de 21 días desde su creación. Vence el {date(review.expiresAt)}.</p>}
        {review && state.canManageReviewClosure && <ClosePartnerReviewButton key={review.id}
          projectId={projectId} sectionId={section.id} sectionLabel={section.code} reviewId={review.id}
          evaluatedCount={review.evaluatedCount} totalTeams={review.teams.length} canClose={state.canCloseReview} disabled={locked}
          onClosed={() => { setNotice("Revisión cerrada. Revisa el resumen antes de cerrar el Hito 2."); setReload((value) => value + 1); }} />}
        {state.teamsChanged && <p role="alert" className="hito-two__error">Los equipos o sus videos cambiaron desde la entrega. Coordinación debe revocar la revisión anterior y preparar una nueva.</p>}
        {review && !review.completedAt && Date.parse(review.expiresAt) <= Date.now() && <p role="alert">El enlace del socio venció y ya no admite evaluaciones. Puedes cerrar la revisión si tiene respuestas guardadas, o solicitar una nueva a coordinación.</p>}
        {reviewLink && <div className="hito-two__link"><label htmlFor="hito-two-review-url">Enlace de evaluación del socio formador</label><input id="hito-two-review-url" className="control" readOnly value={reviewLink} onFocus={(event) => event.target.select()} /><Button type="button" variant="secondary" icon={Copy} onClick={() => copy(reviewLink)}>Copiar enlace del socio</Button></div>}
      </section>}
      {review?.completedAt && <section className="hito-two__phase" aria-label="Resumen de retroalimentación">
        <h3>{review.evaluatedCount ? "Retroalimentación final" : "Cerrada sin respuestas"} · Sección {section.code}</h3>
        <p>Finalizada el {date(review.completedAt)}{review.closedInternally ? ` mediante cierre interno${review.closedByName ? ` por ${review.closedByName}` : ""}` : ""}.
          {` ${review.evaluatedCount} de ${review.teams.length} equipos evaluados.`} {average ? <>Valoración promedio: <strong>{average}/5</strong>. Sólo considera los equipos evaluados.</> : "Sin valoración promedio. No hay evaluaciones guardadas y el Hito 2 no puede cerrarse con esta revisión."}</p>
        {review.teams.map((team) => {
          const evaluation = review.evaluations.find((item) => item.teamId.toLowerCase() === team.id.toLowerCase());
          return <article key={team.id} className="hito-two__evaluation"><h4>{team.name} <span>{evaluation ? `${evaluation.rating}/5` : "Sin evaluar"}</span></h4>
            {evaluation ? <dl><dt>Fortalezas observadas</dt><dd>{evaluation.strengths}</dd><dt>Observaciones y propuestas de mejora</dt><dd>{evaluation.improvements}</dd></dl>
              : <p>No se recibió una evaluación guardada para este equipo. No se incluye en el promedio.</p>}</article>;
        })}
      </section>}
      {!closed && state.feedbackReady && <form className="form-grid hito-two__phase" onSubmit={submit}>
        <div className="hito-two__full"><h3>Revisa el resumen y cierra el Hito 2</h3><p>Registra los resultados de tu sección considerando la retroalimentación del socio formador.</p></div>
        <Field label="Avance del resultado" required><Textarea name="advance" rows={5} maxLength={20000} required disabled={locked} value={progress.advance} onChange={(event) => setProgress({ ...progress, advance: event.target.value })} /></Field>
        <Field label="Conclusiones" required><Textarea name="conclusions" rows={5} maxLength={20000} required disabled={locked} value={progress.conclusions} onChange={(event) => setProgress({ ...progress, conclusions: event.target.value })} /></Field>
        <label className="hito-two__ack"><input type="checkbox" checked={acknowledged} disabled={locked} required onChange={(event) => setAcknowledged(event.target.checked)} />Revisé la retroalimentación final de los equipos de mi sección.</label>
        <div className="form-actions"><Button type="submit" disabled={locked || !acknowledged}>{saving ? "Cerrando Hito 2…" : "Cerrar Hito 2 de mi sección"}</Button></div>
      </form>}
      {closed && <p className="hito-two__notice">Hito 2 cerrado.{state.feedbackReviewedAt ? ` Retroalimentación revisada el ${date(state.feedbackReviewedAt)}.` : " Cierre histórico conservado, anterior al flujo en dos fases."}</p>}
    </>}
    {publishDialogOpen && !closed && <ReviewFinishDialog saving={busy} error={publishError}
      title="¿Registrar los videos y solicitar retroalimentación?"
      description={`Se registrarán los videos de los equipos de esta sección y se generará un enlace exclusivo para el socio formador válido por 21 días. El Hito 2 sólo podrá cerrarse después de finalizar la revisión y leer el resumen.${state?.uploadEnabled === true ? " Las entregas directas de alumnos quedarán bloqueadas mientras esta revisión esté vigente." : ""}`}
      cancelLabel="Volver a los videos" confirmLabel="Sí, registrar y solicitar" savingLabel="Registrando entrega…"
      onCancel={() => { if (!busy && !publishingRef.current) { setPublishDialogOpen(false); setPublishError(""); } }} onConfirm={publish} />}
    {closingReviewId && !closed && <ReviewFinishDialog saving={saving || submittingClose} error={closeError}
      title={`¿Cerrar el Hito 2 de la sección ${section.code}?`}
      description="Confirmas que revisaste la retroalimentación final del socio formador. Se guardarán el avance y las conclusiones, y se cerrará únicamente el Hito 2 de esta sección. Si necesitas corregirlo después, coordinación deberá reabrirlo."
      cancelLabel="Volver al resumen" confirmLabel="Sí, cerrar Hito 2" savingLabel="Cerrando Hito 2…"
      onCancel={() => { if (!saving && !closingRef.current) { setClosingReviewId(null); setCloseError(""); } }} onConfirm={confirmClose} />}
  </Card>;
}
