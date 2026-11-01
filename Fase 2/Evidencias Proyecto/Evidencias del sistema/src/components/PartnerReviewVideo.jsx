import { RefreshCw, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getPartnerReviewVideo } from "../services/partnerReviewApi";

export default function PartnerReviewVideo({ team, token, demo }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const resumeTime = useRef(0);
  const videoRef = useRef(null);
  const resumePlayback = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setResult(null);
    const resolve = demo
      ? import.meta.env.DEV ? import("../services/demoPartnerVideo.js").then((module) => module.getDemoPartnerVideo(team))
        : Promise.reject(new Error("La demostración sólo está disponible en desarrollo."))
      : getPartnerReviewVideo(token, team.id);
    resolve.then((data) => { if (active) setResult(data); })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [team, token, demo, retry]);

  useEffect(() => {
    if (!result?.expiresAt || error) return undefined;
    const remaining = Date.parse(result.expiresAt) - Date.now() - 30_000;
    const timer = window.setTimeout(() => {
      if (videoRef.current) {
        resumeTime.current = videoRef.current.currentTime;
        resumePlayback.current = !videoRef.current.paused;
      }
      setRetry((value) => value + 1);
    }, Math.max(5000, remaining));
    return () => window.clearTimeout(timer);
  }, [result, error]);

  const retryVideo = () => {
    if (videoRef.current) {
      resumeTime.current = videoRef.current.currentTime;
      resumePlayback.current = !videoRef.current.paused;
    }
    setRetry((value) => value + 1);
  };
  const ready = result?.status === "available" && !error;
  return <div className="review-video">
    {ready ? <video ref={videoRef} src={result.url} controls preload="metadata" playsInline aria-label={`Video de ${team.name}`}
      onLoadedMetadata={(event) => {
        if (resumeTime.current > 0) event.currentTarget.currentTime = resumeTime.current;
        if (resumePlayback.current) event.currentTarget.play().catch(() => {});
      }}
      onError={(event) => { resumeTime.current = event.currentTarget.currentTime; setError("No fue posible reproducir el video. Vuelve a cargarlo para obtener un acceso actualizado."); }} />
      : <div className="review-video-placeholder" aria-busy={loading}>
        <span><Video size={36} strokeWidth={1.5} /></span>
        <h3>{loading ? "Buscando el video…" : error ? "Video no disponible" : "Video demostrativo"}</h3>
        <p role={error ? "alert" : undefined}>{loading ? `Consultando el video de ${team.name}.` : error || (result?.status === "unassigned"
          ? "La coordinación debe revisar el nombre del equipo para asociar su video."
          : `El video de ${team.name} estará disponible aquí cuando sea incorporado.`)}</p>
        {!loading && <><small>{error ? "Puedes continuar con la revisión" : "Pendiente de incorporación"}</small><button className="review-video-retry" type="button" onClick={retryVideo}><RefreshCw size={14} />{error ? "Volver a cargar" : "Buscar nuevamente"}</button></>}
      </div>}
    {ready && <div className="review-video-file"><span>{result.filename}</span><button className="review-video-retry" type="button" onClick={retryVideo}><RefreshCw size={13} />Actualizar video</button></div>}
  </div>;
}
