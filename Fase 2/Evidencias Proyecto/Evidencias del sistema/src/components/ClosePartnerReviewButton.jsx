import { useRef, useState } from "react";
import { Button } from "./UI";
import ReviewFinishDialog from "./ReviewFinishDialog";
import { closeSectionPartnerReview } from "../services/partnerReviewApi";

export default function ClosePartnerReviewButton({ projectId, sectionId, sectionLabel, reviewId,
  evaluatedCount, totalTeams, canClose, disabled, onClosed }) {
  const [confirmation, setConfirmation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const current = `${projectId}:${sectionId}:${reviewId}`;
  const open = confirmation === current;
  const remaining = totalTeams - evaluatedCount;
  const confirm = async () => {
    if (!open || pending.current || !canClose || disabled || evaluatedCount < 1) return;
    pending.current = true;
    setSaving(true); setError("");
    try {
      const result = await closeSectionPartnerReview(projectId, sectionId, reviewId);
      setConfirmation(null);
      onClosed(result);
    } catch (failure) {
      setError(failure.message || "No se pudo cerrar la revisión. Intenta nuevamente.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return <div className="review-section-close">
    <Button type="button" variant="secondary" disabled={disabled || saving || !canClose || evaluatedCount < 1}
      onClick={() => { setError(""); setConfirmation(current); }}>Cerrar revisión del socio</Button>
    {evaluatedCount < 1 && <p>Se necesita al menos una evaluación guardada para cerrar la revisión.</p>}
    {open && <ReviewFinishDialog saving={saving} error={error}
      title={`¿Cerrar la revisión de la sección ${sectionLabel}?`}
      description={`Se cerrará con ${evaluatedCount} de ${totalTeams} equipos evaluados. ${remaining > 0 ? remaining === 1 ? "El equipo restante quedará «Sin evaluar» y no se incluirá en el promedio. " : `Los ${remaining} equipos restantes quedarán «Sin evaluar» y no se incluirán en el promedio. ` : ""}Se conservarán únicamente las respuestas guardadas y el socio ya no podrá modificarlas ni agregar evaluaciones. Este paso no cierra el Hito 2.`}
      cancelLabel="Seguir esperando" confirmLabel="Sí, cerrar revisión" savingLabel="Cerrando revisión…"
      onCancel={() => { if (!pending.current) { setConfirmation(null); setError(""); } }} onConfirm={confirm} />}
  </div>;
}
