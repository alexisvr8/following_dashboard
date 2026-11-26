// Gmail corta por exceso de uso con "User-rate limit exceeded. Retry after <ISO>": hasta esa hora cualquier llamada
// falla, y reintentar solo suma pedidos. Se guarda la hora (en memoria del proceso) para que la sync no insista y la UI
// lo explique. Mismo criterio que la pausa de IA (`lib/llm/ai-limit.ts`).
const g = globalThis as unknown as { __googlePausedUntil?: number };

/** Hora hasta la que Google pidió no reintentar, si el error la trae. */
export function retryAfterOf(error: unknown): Date | null {
  const msg = (error as { message?: string })?.message ?? String(error ?? "");
  const m = msg.match(/retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  const at = m ? new Date(m[1]) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

export const isUserRateLimit = (error: unknown) => /user-?rate limit exceeded|rate ?limit exceeded/i.test((error as { message?: string })?.message ?? "");

/** Registra la pausa si el error trae "Retry after". Devuelve la hora o null. */
export function noteGoogleLimit(error: unknown): Date | null {
  const at = retryAfterOf(error);
  if (at && at.getTime() > Date.now()) g.__googlePausedUntil = Math.max(g.__googlePausedUntil ?? 0, at.getTime());
  return at;
}

/** ISO de hasta cuándo está pausado Google, o null si se puede llamar. */
export function googlePausedUntil(): string | null {
  const t = g.__googlePausedUntil;
  return t && t > Date.now() ? new Date(t).toISOString() : null;
}
