const MAX_WAIT_MS = 120_000;
const ATTEMPT_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 3_000;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function unavailableError() {
  return new Error("No pudimos conectar con el sistema en este momento. Espera un momento y vuelve a intentarlo.");
}

function pause(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, RETRY_DELAY_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Only repeat the public, read-only health check. Never repeat credential submissions.
export async function waitForSystemReady({ signal } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const deadline = setTimeout(() => controller.abort(unavailableError()), MAX_WAIT_MS);

  try {
    while (true) {
      controller.signal.throwIfAborted();
      const attempt = new AbortController();
      const abortAttempt = () => attempt.abort(controller.signal.reason);
      controller.signal.addEventListener("abort", abortAttempt, { once: true });
      const timeout = setTimeout(() => attempt.abort(), ATTEMPT_TIMEOUT_MS);

      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          credentials: "omit",
          signal: attempt.signal,
        });
        if (response.ok) {
          const payload = await response.json();
          controller.signal.throwIfAborted();
          if (payload.status === "ok" && payload.service === "vcm-piloto-2026-api") return;
          throw unavailableError();
        }
        if (!TRANSIENT_STATUSES.has(response.status)) throw unavailableError();
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!(error instanceof TypeError) && error.name !== "AbortError") throw unavailableError();
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abortAttempt);
      }

      await pause(controller.signal);
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}
