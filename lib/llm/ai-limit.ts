// Límite de gasto / saldo de la API de Anthropic. Ese error no es culpa de la reunión ni del mail: no cuenta como
// intento fallido (así se reintenta cuando vuelve el acceso) y pausa las llamadas de la sync hasta esa fecha, para no
// insistir cada 15 min con cada cuenta. La pausa vive en el proceso (se reinicia con el server, sin costo: la primera
// llamada vuelve a fallar sin cobrarse y la reactiva).

const LIMIT_RE = /usage limits?|credit balance is too low|regain access on/i;
const FALLBACK_PAUSE_MS = 60 * 60_000;

declare global {
  var __aiPausedUntil: number | undefined;
}

/** ¿El error es por límite de gasto o saldo de la cuenta de la API? */
export const isAILimitError = (message: string | null | undefined) => Boolean(message && LIMIT_RE.test(message));

/** Registra la pausa: hasta la fecha que informa la API ("regain access on 2026-12-01 at 00:00 UTC") o 1 h. */
export function pauseAIFor(message: string, now = Date.now()): number {
  const m = message.match(/regain access on (\d{4}-\d{2}-\d{2})(?: at (\d{2}:\d{2}))?/i);
  const until = m ? Date.parse(`${m[1]}T${m[2] ?? "00:00"}:00Z`) : NaN;
  globalThis.__aiPausedUntil = Number.isFinite(until) && until > now ? until : now + FALLBACK_PAUSE_MS;
  return globalThis.__aiPausedUntil;
}

/** Si la IA está en pausa por límite, hasta cuándo (ms); null si se puede llamar. */
export function aiPausedUntil(now = Date.now()): number | null {
  const until = globalThis.__aiPausedUntil;
  return until && until > now ? until : null;
}
