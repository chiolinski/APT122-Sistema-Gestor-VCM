import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, Card, Field } from "../components/UI";
import { beginVideoUpload, confirmVideoUpload, getVideoDelivery } from "../services/partnerReviewApi";
import "../components/hitoTwo.css";

export default function StudentVideoDeliveryPage() {
  const { hash } = useLocation();
  return <DeliverySession key={hash} token={hash.slice(1)} />;
}

function DeliverySession({ token }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [attemptId, setAttemptId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const abortRef = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    (token ? getVideoDelivery(token) : Promise.reject(new Error("El enlace está incompleto. Solicita el enlace completo a tu docente.")))
      .then((data) => { if (active) setContext(data); })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; abortRef.current?.abort(); };
  }, [token, reload]);
  useEffect(() => {
    if (!busy) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const confirmed = async (id) => {
    const result = await confirmVideoUpload(token, id);
    setContext((current) => ({ ...current, ...result }));
    setAttemptId(""); setNotice("Video entregado y confirmado. Tu docente podrá registrar la entrega de todos los equipos.");
  };
  const upload = async (event) => {
    event.preventDefault();
    if (busy || !file || !context?.open) return;
    if (!/\.mp4$/i.test(file.name) || file.size <= 0 || file.size > context.maxBytes) { setError("Selecciona un video MP4 de hasta 200 MB."); return; }
    if (context.deliveredAt && !window.confirm("¿Entregar otro video para tu equipo? Reemplazará la entrega anterior antes de su envío al socio formador.")) return;
    setBusy(true); setError(""); setNotice("Preparando la carga…");
    try {
      const attempt = await beginVideoUpload(token, file);
      setAttemptId(attempt.attemptId);
      abortRef.current = new AbortController();
      setNotice("Subiendo video… Mantén esta página abierta.");
      const response = await fetch(attempt.url, { method: "PUT", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "video/mp4", "If-None-Match": "*" }, body: file, signal: abortRef.current.signal });
      // A repeated create-only PUT can mean the previous upload succeeded: verify server-side.
      if (!response.ok && response.status !== 409 && response.status !== 412) throw new Error("La carga a Azure no se completó. Comprueba tu conexión; si persiste, informa al docente para revisar la configuración de carga.");
      setNotice("Comprobando el archivo recibido…");
      await confirmed(attempt.attemptId);
    } catch (failure) { setNotice(""); setError(failure.message === "Failed to fetch" ? "No se pudo conectar con la carga de Azure. Revisa tu conexión o informa al docente para comprobar CORS y permisos." : failure.message); }
    finally { setBusy(false); }
  };
  const retryConfirmation = async () => {
    if (busy || !attemptId) return;
    setBusy(true); setError("");
    try { await confirmed(attemptId); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <main className="student-video-delivery">
    <img src="/brand/citt-duocuc-color.png" alt="CITT Duoc UC" width="1642" height="596" />
    <Card className="panel-card"><h1>Entrega de video · Hito 2</h1>
      {loading && <p role="status">Consultando el enlace de entrega…</p>}
      {error && <p role="alert" className="hito-two__error">{error}</p>}
      <div aria-live="polite">{notice && <p className="hito-two__notice">{notice}</p>}</div>
      {context && <><h2>{context.teamName}</h2><p>{context.projectName}<br />{context.campusName} · Sección {context.sectionCode}</p>
        {context.deliveredAt && <p className="hito-two__notice">Entrega confirmada: {context.filename}.</p>}
        {context.uploadEnabled === false ? <p>La carga directa todavía no está habilitada. Contacta a tu docente para coordinar la entrega.</p> : context.open ? <form onSubmit={upload}><Field label="Video del equipo" required hint="Archivo MP4, máximo 200 MB. No incluyas datos personales innecesarios."><input name="video" type="file" accept="video/mp4,.mp4" required disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] || null); setError(""); }} /></Field>
          <p>El video será utilizado para la revisión docente y del socio formador. El almacenamiento actual permite lectura pública a quien conozca la URL del archivo. Comparte este enlace sólo con tu equipo.</p>
          <Button type="submit" disabled={busy || !file}>{busy ? "Procesando video…" : "Subir y confirmar entrega"}</Button>
          {attemptId && !busy && <Button type="button" variant="secondary" onClick={retryConfirmation}>Reintentar confirmación sin volver a subir</Button>}
        </form> : <p>Las entregas están bloqueadas porque la revisión ya fue enviada o el Hito 2 no está abierto. Contacta a tu docente si necesitas una corrección.</p>}
      </>}
      {!context && !loading && <Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)}>Intentar nuevamente</Button>}
    </Card>
  </main>;
}
