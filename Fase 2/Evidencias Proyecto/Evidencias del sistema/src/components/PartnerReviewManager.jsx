import { Copy, Link2, RefreshCw, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, Field, Select } from "./UI";
import { createPartnerReview, listPartnerReviews, revokePartnerReview } from "../services/partnerReviewApi";
import ClosePartnerReviewButton from "./ClosePartnerReviewButton";
import "./partnerReviewManager.css";

const date = (value) => new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeZone: "America/Santiago" }).format(new Date(value));

export default function PartnerReviewManager({ projectId, sections }) {
  const [selectedId, setSelectedId] = useState(sections[0]?.id || "");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState(null);
  const [reload, setReload] = useState(0);
  const sectionId = sections.some((item) => item.id === selectedId) ? selectedId : sections[0]?.id || "";

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    listPartnerReviews(projectId).then((data) => { if (active) setReviews(data); })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, reload]);

  const create = async () => {
    if (busy || (activeReview && !window.confirm("¿Crear una nueva revisión para esta sección? El enlace anterior dejará de funcionar y la nueva revisión comenzará sin evaluaciones. Las respuestas anteriores se conservarán para consulta."))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await createPartnerReview(projectId, sectionId);
      setLink({ id: result.id, sectionId, url: `${window.location.origin}/revision-socio#${result.token}`, expiresAt: result.expiresAt });
      setNotice("Enlace creado. Cópialo y compártelo con el socio formador de esta sección.");
      setReviews(await listPartnerReviews(projectId));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const revoke = async (reviewId) => {
    if (busy || !window.confirm("¿Revocar este enlace de revisión? El socio formador ya no podrá usarlo. Las evaluaciones guardadas se conservarán para consulta interna.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await revokePartnerReview(projectId, reviewId);
      setReviews((current) => current.map((item) => item.id === reviewId ? { ...item, active: false, revokedAt: new Date().toISOString() } : item));
      if (link?.id === reviewId) setLink(null);
      setNotice("El enlace fue revocado. Las evaluaciones recibidas se conservan.");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setNotice("Enlace copiado."); }
    catch { setNotice("Selecciona el enlace del recuadro y cópialo manualmente."); }
  };

  const sectionReviews = reviews.filter((item) => item.sectionId.toLowerCase() === sectionId.toLowerCase());
  const activeReview = sectionReviews.find((item) => item.active);

  return <Card className="panel-card partner-review-manager">
    <div className="card-heading"><div><h2>Revisión del socio formador</h2><p>Un enlace privado por socio formador y sección de VcM 2026-2.</p></div>
      <Button type="button" variant="secondary" icon={RefreshCw} disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>Actualizar revisiones</Button></div>
    <Field label="Sección que revisará el socio formador"><Select value={sectionId} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setNotice(""); setError(""); }}>{sections.map((section) => <option key={section.id} value={section.id}>{section.campusName} · {section.code}</option>)}</Select></Field>
    {loading && <p role="status">Cargando revisiones…</p>}
    {error && <div className="partner-review-manager__error" role="alert">{error}<Button variant="secondary" icon={RefreshCw} disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>Actualizar</Button></div>}
    <p className="partner-review-manager__hint">El enlace dura como máximo 21 días desde su creación y da acceso a los equipos conformados al momento de crearlo. Su vencimiento bloquea nuevas evaluaciones, pero no cierra la revisión ni el Hito 2.</p>
    <Button icon={Link2} disabled={busy || loading || !sectionId || Boolean(error)} onClick={create}>{busy ? "Procesando…" : activeReview ? "Crear nueva revisión y enlace" : "Crear enlace de revisión"}</Button>
    {activeReview && <p className="partner-review-manager__hint">Crear otra revisión desactiva el enlace anterior de esta sección e inicia evaluaciones nuevas. Las respuestas anteriores se conservan debajo.</p>}
    {link?.sectionId === sectionId && <div className="partner-review-manager__link"><label htmlFor="partner-review-url">Enlace exclusivo · Vence el {date(link.expiresAt)}</label><input id="partner-review-url" className="control" value={link.url} readOnly onFocus={(event) => event.target.select()} /><Button variant="secondary" icon={Copy} onClick={copy}>Copiar enlace</Button><small>Este enlace se muestra sólo al crearlo. Guárdalo antes de salir de la página.</small></div>}
    <div aria-live="polite">{notice && <p className="partner-review-manager__notice">{notice}</p>}</div>
    {!loading && !error && !sectionReviews.length && <p className="partner-review-manager__hint">Esta sección aún no tiene una revisión creada.</p>}
    {sectionReviews.map((review) => <details key={review.id} className="partner-review-manager__record" open={review.active || undefined}>
      <summary>Revisión del {date(review.createdAt)} · {review.evaluations.length}/{review.teams.length} equipos <span>{review.completedAt ? review.closedInternally && !review.evaluations.length ? "Cerrada sin respuestas" : "Finalizada" : "En curso"} · {review.active ? "Enlace activo" : "Enlace inactivo"}</span></summary>
      {review.active && <div className="partner-review-manager__revoke"><small>Vence el {date(review.expiresAt)}</small><Button variant="secondary" icon={ShieldOff} disabled={busy} onClick={() => revoke(review.id)}>Revocar enlace</Button></div>}
      {review.closedInternally && <p className="partner-review-manager__hint">Cierre interno{review.closedByName ? ` por ${review.closedByName}` : ""} el {date(review.completedAt)}. Se conservaron {review.evaluations.length} de {review.teams.length} evaluaciones.</p>}
      {review.canManageClosure && <ClosePartnerReviewButton projectId={projectId} sectionId={review.sectionId}
        sectionLabel={sections.find((item) => item.id.toLowerCase() === review.sectionId.toLowerCase())?.code || sectionId}
        reviewId={review.id} evaluatedCount={review.evaluations.length} totalTeams={review.teams.length}
        canClose={review.canClose} disabled={busy || loading || Boolean(error)}
        onClosed={(result) => {
          setReviews((current) => current.map((item) => item.id === review.id
            ? { ...item, ...result, canClose: false, canManageClosure: false } : item));
          if (link?.id === review.id) setLink(null);
          setNotice("Revisión cerrada con las respuestas guardadas. El docente debe revisar el resumen antes de cerrar el Hito 2.");
          setReload((value) => value + 1);
        }} />}
      {review.teams.map((team) => {
        const evaluation = review.evaluations.find((item) => item.teamId.toLowerCase() === team.id.toLowerCase());
        return <div key={team.id} className="partner-review-manager__evaluation"><strong>{team.name}</strong>{evaluation ? <><span>{evaluation.rating} de 5 estrellas · {date(evaluation.reviewedAt)}</span><dl><dt>Fortalezas observadas</dt><dd>{evaluation.strengths}</dd><dt>Observaciones / propuestas de mejora</dt><dd>{evaluation.improvements}</dd></dl></> : <span>{review.completedAt ? "Sin evaluar · No se incluye en el promedio" : "Pendiente de evaluación"}</span>}</div>;
      })}
    </details>)}
  </Card>;
}
