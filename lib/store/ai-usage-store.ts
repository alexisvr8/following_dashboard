import { getState, setState } from "@/lib/store/backend";

// Registro de cada llamada a Claude (`app_state.ai_usage`, o `.data/ai-usage.json`): tipo, cuenta, modelo y tokens
// que devuelve la API (`response.usage`). Sirve para ver cuánto consume cada flujo. Se guardan los últimos
// `KEEP_DAYS` días (tope `MAX_ENTRIES`). Las escrituras se encadenan en el proceso para no pisarse cuando
// corren llamadas en paralelo (análisis semanal: 2 a la vez); `app_state` no tiene control de versión.

export type AIUsageKind = "postmeeting" | "status" | "analysis";

export interface AIUsageEntry {
  at: string;
  kind: AIUsageKind;
  model: string;
  clientId?: string;
  clientName?: string;
  /** Script o flujo que la disparó (sync, Actualizar, Reanalizar, preview…), si se sabe. */
  trigger?: string;
  /** false = la API respondió pero no sirvió (cortada, rechazo, JSON inválido): igual se cobra. */
  ok: boolean;
  stop?: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageMeta {
  clientId?: string;
  clientName?: string;
  trigger?: string;
}

/** Forma de `response.usage` que interesa (los campos de caché pueden venir null). */
export interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const KEEP_DAYS = 120;
const MAX_ENTRIES = 5000;

const g = globalThis as unknown as { __aiUsageQueue?: Promise<void> };

export async function getAIUsage(): Promise<AIUsageEntry[]> {
  return (await getState<AIUsageEntry[]>("ai_usage")) ?? [];
}

/** Agrega una entrada. Nunca lanza: un fallo del registro no puede romper la llamada a la IA. */
export function recordAIUsage(
  kind: AIUsageKind,
  model: string,
  usage: RawUsage | null | undefined,
  meta: UsageMeta = {},
  result: { ok: boolean; stop?: string | null } = { ok: true },
): Promise<void> {
  if (!usage) return Promise.resolve();
  const entry: AIUsageEntry = {
    at: new Date().toISOString(),
    kind,
    model,
    ...meta,
    ok: result.ok,
    stop: result.stop ?? null,
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
  const next = (g.__aiUsageQueue ?? Promise.resolve()).then(async () => {
    const since = Date.now() - KEEP_DAYS * 86_400_000;
    const kept = (await getAIUsage()).filter((e) => Date.parse(e.at) >= since);
    kept.push(entry);
    await setState("ai_usage", kept.slice(-MAX_ENTRIES));
  });
  g.__aiUsageQueue = next.catch((e) => console.error("[ai-usage] no se pudo registrar:", (e as Error).message));
  return g.__aiUsageQueue;
}

/** Registra una respuesta de `messages.parse`: sirvió si terminó normal y trajo el JSON. */
export function recordResponse(
  kind: AIUsageKind,
  model: string,
  response: { usage?: RawUsage | null; stop_reason?: string | null; parsed_output?: unknown },
  meta?: UsageMeta,
): Promise<void> {
  const ok = response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens" && response.parsed_output != null;
  return recordAIUsage(kind, model, response.usage, meta, { ok, stop: response.stop_reason ?? null });
}
