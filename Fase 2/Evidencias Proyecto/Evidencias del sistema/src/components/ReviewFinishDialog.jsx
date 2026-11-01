import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button } from "./UI";
import "./reviewFinishDialog.css";

export default function ReviewFinishDialog({ saving, error, onCancel, onConfirm,
  title = "¿Finalizar tu revisión?",
  description = "Las evaluaciones de todos los equipos quedarán disponibles para consulta. Después de finalizar, ya no podrás modificar tus comentarios ni valoraciones.",
  cancelLabel = "Seguir revisando", confirmLabel = "Sí, finalizar revisión", savingLabel = "Finalizando…" }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    cancelRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className="review-finish-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-description`} aria-modal="true" aria-busy={saving}
    onCancel={(event) => { event.preventDefault(); if (!saving) onCancel(); }}>
    <span className="modal__icon" aria-hidden="true"><LockKeyhole size={23} /></span>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    {error && <p className="review-finish-dialog__error" role="alert">{error}</p>}
    <div className="review-finish-dialog__actions">
      <Button ref={cancelRef} type="button" variant="secondary" disabled={saving} onClick={onCancel}>{cancelLabel}</Button>
      <Button type="button" icon={saving ? LoaderCircle : undefined} disabled={saving} onClick={onConfirm}>{saving ? savingLabel : confirmLabel}</Button>
    </div>
  </dialog>;
}
