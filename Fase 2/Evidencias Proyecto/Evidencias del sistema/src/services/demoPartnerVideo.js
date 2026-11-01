import { buildVideoBlobUrl, DEMO_VIDEO_CONTEXT, findTeamVideo } from "../../api/src/shared/partnerVideoPaths.mjs";

// Sólo se importa desde la ruta de demostración en desarrollo. No contiene credenciales.
export async function getDemoPartnerVideo(team) {
  return findTeamVideo(DEMO_VIDEO_CONTEXT, team, async (blobName) => {
    const url = buildVideoBlobUrl(blobName);
    const response = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(5000) });
    // No descargar el archivo para comprobar su existencia, incluso si el servidor ignora Range.
    await response.body?.cancel();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("No fue posible consultar el video. Intenta nuevamente.");
    if (response.headers.get("content-type")?.split(";")[0].toLowerCase() !== "video/mp4"
      || Number(response.headers.get("content-length")) <= 0) {
      throw new Error("El archivo del equipo debe ser un video MP4 válido.");
    }
    return { url, expiresAt: null };
  });
}
