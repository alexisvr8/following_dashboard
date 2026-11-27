// Gmail corta por exceso de uso con "User-rate limit exceeded. Retry after <ISO>": hasta esa hora cualquier llamada
// falla y, peor, cada llamada durante el corte lo renueva (~15 min desde ese pedido). Se guarda la hora para que NADA
// (sync, botones, scripts del proceso) llame a Gmail mientras dure: el filtro está en el cliente OAuth
// (`google-client.ts`), así cubre todas las llamadas. Si Google vuelve a cortar apenas termina la pausa, la siguiente
// se duplica (15 → 30 → 60 → 120 min) para darle silencio de verdad. Persistida (`app_state.google_pause`) para que
// reiniciar la app no la pierda. Mismo criterio que la pausa de IA (`lib/llm/ai-limit.ts`).
import { getState, setState } from "@/lib/store/backend";

type Pause = { until: number; strikes: number };
const g = globalThis as unknown as { __googlePause?: Pause; __googlePauseLoaded?: Promise<void> };

const BASE_MS = 15 * 60_000;
const MAX_MS = 2 * 60 * 60_000;
/** Corte dentro de este margen después de terminada la pausa anterior = Google no soltó: se escala. */
const RELAPSE_MS = 30 * 60_000;

/** Hora hasta la que Google pidió no reintentar, si el error la trae. */
export function retryAfterOf(error: unknown): Date | null {
  const msg = (error as { message?: string })?.message ?? String(error ?? "");
  const m = msg.match(/retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  const at = m ? new Date(m[1]) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

export const isUserRateLimit = (error: unknown) => /user-?rate limit exceeded|rate ?limit exceeded/i.test((error as { message?: string })?.message ?? "");

/** Carga (una vez por proceso) la pausa guardada: sobrevive a reinicios. */
export function loadGooglePause(): Promise<void> {
  g.__googlePauseLoaded ??= getState<Pause>("google_pause")
    .then((saved) => {
      if (saved && (!g.__googlePause || saved.until > g.__googlePause.until)) g.__googlePause = saved;
    })
    .catch(() => undefined);
  return g.__googlePauseLoaded;
}

function persist() {
  void setState("google_pause", g.__googlePause ?? null).catch(() => undefined);
}

/** Registra la pausa si el error trae "Retry after" (escalando si es una recaída). Devuelve hasta cuándo o null. */
export function noteGoogleLimit(error: unknown): Date | null {
  const at = retryAfterOf(error);
  if (!at) return null;
  const now = Date.now();
  const prev = g.__googlePause ?? { until: 0, strikes: 0 };
  let { until, strikes } = prev;
  if (now >= prev.until) {
    // Pausa vencida (o primera): si recién terminó y Google cortó de nuevo, se espera el doble que la vez anterior.
    strikes = prev.until > 0 && now - prev.until < RELAPSE_MS ? prev.strikes + 1 : 0;
    until = strikes > 0 ? now + Math.min(MAX_MS, BASE_MS * 2 ** strikes) : 0;
  }
  until = Math.max(until, at.getTime());
  if (until <= now) return at;
  if (until !== prev.until || strikes !== prev.strikes) {
    g.__googlePause = { until, strikes };
    persist();
  }
  return new Date(until);
}

/** Una llamada a Gmail anduvo: se olvida la escalada. */
export function noteGoogleOk() {
  if (g.__googlePause?.strikes) {
    g.__googlePause = { until: 0, strikes: 0 };
    persist();
  }
}

/** ISO de hasta cuándo está pausado Gmail, o null si se puede llamar. */
export function googlePausedUntil(): string | null {
  const t = g.__googlePause?.until;
  return t && t > Date.now() ? new Date(t).toISOString() : null;
}
