import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Select } from "./UI";
import ReviewFinishDialog from "./ReviewFinishDialog";
import { closeBulkPartnerReviews, getBulkReviewPeriods, previewBulkReviewClosure } from "../services/partnerReviewApi";
import "./bulkPartnerReviewClosure.css";

const outcomes = { withFeedback: "Cerrar con respuestas guardadas", withoutFeedback: "Cerrar sin respuestas", alreadyCompleted: "Desactivar enlace; conservar revisión finalizada" };

export default function BulkPartnerReviewClosure() {
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    getBulkReviewPeriods().then((data) => { if (active) setPeriods(data); })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const loadPreview = async () => {
    if (!period || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setResult(null); setPreview(null); setStep(0);
    try { setPreview(await previewBulkReviewClosure(period)); }
    catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  };
  const close = async () => {
    if (pending.current || step !== 2 || !preview?.summary.links || preview.period !== period) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const data = await closeBulkPartnerReviews({ period: preview.period, generatedAt: preview.generatedAt,
        revision: preview.revision, confirmed: true, confirmation: preview.period });
      setResult(data); setPreview(null); setStep(0);
    } catch (failure) {
      setError(failure.message);
      if (["BULK_PREVIEW_CHANGED", "BULK_NOTHING_TO_CLOSE"].includes(failure.code)) { setStep(0); setPreview(null); }
    } finally { pending.current = false; setBusy(false); }
  };
  const cancel = () => { if (!pending.current) { setStep(0); setError(""); } };
  const summary = preview?.summary;

  return <Card className="panel-card bulk-review-closure">
    <div className="card-heading"><div><h2>Cierre masivo de enlaces del socio</h2><p>Cierre manual para todas las sedes del período seleccionado.</p></div></div>
    <p>Bloquea los enlaces existentes, incluidos los de revisiones ya finalizadas. Conserva las respuestas y los resúmenes para consulta interna. Las revisiones pendientes vencidas también se cierran.</p>
    <p>Las revisiones sin respuestas quedan como «Cerrada sin respuestas» y no habilitan el cierre del Hito 2. Cada docente debe revisar su retroalimentación y cerrar el hito por separado. Los enlaces nuevos que se creen después no quedan bloqueados por esta operación.</p>
    <div className="bulk-review-closure__controls">
      <Field label="Período académico"><Select value={period} disabled={loading || busy || step > 0} onChange={(event) => {
        setPeriod(event.target.value); setPreview(null); setResult(null); setError("");
      }}><option value="">Selecciona un período</option>{periods.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}</Select></Field>
      <Button type="button" variant="secondary" disabled={!period || loading || busy || step > 0} onClick={loadPreview}>{busy ? "Procesando…" : "Revisar enlaces"}</Button>
    </div>
    {loading && <p role="status">Cargando períodos…</p>}
    {error && !step && <p role="alert" className="bulk-review-closure__error">{error}</p>}
    {result && <p role="status" className="bulk-review-closure__result">Cierre registrado para {result.period}. Enlaces desactivados: {result.summary.links}. Revisiones cerradas con respuestas: {result.summary.withFeedback}; sin respuestas: {result.summary.withoutFeedback}. Revisiones ya finalizadas conservadas: {result.summary.alreadyCompleted}. El Hito 2 permanece sin cambios.</p>}
    {preview && <section aria-label="Vista previa del cierre masivo">
      <h3>Enlaces del período {preview.period}</h3>
      <p>Enlaces afectados: {summary.links}. Revisiones pendientes con respuestas: {summary.withFeedback}; sin respuestas: {summary.withoutFeedback}; ya finalizadas: {summary.alreadyCompleted}. Evaluaciones guardadas que se conservarán: {summary.evaluations}.</p>
      {summary.links > 0 ? <>
        <div className="responsive-table"><table><thead><tr><th>Proyecto</th><th>Sede</th><th>Asignatura / sección</th><th>Evaluaciones</th><th>Resultado del cierre</th></tr></thead><tbody>
          {preview.records.map((record) => <tr key={record.id}><td>{record.projectCode}</td><td>{record.campusName}</td><td>{record.subjectCode} / {record.sectionCode}</td><td>{record.evaluatedCount}/{record.totalTeams}</td><td>{outcomes[record.outcome]}</td></tr>)}
        </tbody></table></div>
        <Button type="button" disabled={busy || step > 0} onClick={() => { setError(""); setStep(1); }}>Cerrar enlaces del período</Button>
      </> : <p>No hay enlaces que cerrar en este período.</p>}
    </section>}
    {step === 1 && preview && <ReviewFinishDialog key="first-confirmation" saving={false} onCancel={cancel}
      title={`¿Cerrar los enlaces del período ${preview.period}?`}
      description={`Primera confirmación: afectará a todas las sedes del período ${preview.period}. Enlaces afectados: ${summary.links}. Revisiones pendientes con respuestas: ${summary.withFeedback}; sin respuestas: ${summary.withoutFeedback}. Enlaces de revisiones ya finalizadas: ${summary.alreadyCompleted}; sus resultados se conservarán. El Hito 2 no se cerrará.`}
      cancelLabel="Volver a la vista previa" confirmLabel="Continuar a la segunda confirmación" onConfirm={() => setStep(2)} />}
    {step === 2 && preview && <ReviewFinishDialog key="second-confirmation" saving={busy} error={error} onCancel={cancel} onConfirm={close}
      title={`Confirmación final · ${preview.period}`}
      description={`Al confirmar, los ${summary.links} enlaces dejarán de estar disponibles para los socios formadores. Las ${summary.evaluations} evaluaciones guardadas se conservarán y se registrará tu usuario, la fecha y el alcance en auditoría. Las revisiones sin respuestas no contarán como evaluadas. Esta operación no tiene deshacer; coordinación podrá crear nuevos enlaces si es necesario. El estado del Hito 2 no cambiará.`}
      cancelLabel="Cancelar cierre masivo" confirmLabel="Sí, cerrar los enlaces" savingLabel="Cerrando enlaces…" />}
  </Card>;
}
