import type { AIUsageEntry } from "@/lib/store/ai-usage-store";

// Precios de lista de la API de Anthropic (US$ por millón de tokens, nov. 2026). Solo para ESTIMAR el gasto del
// registro: la factura real está en console.anthropic.com. Escritura en caché = 1,25× la entrada (TTL 5 min).
// Si cambian los precios o el modelo, actualizar esta tabla; un modelo que no está aquí no suma costo.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Costo estimado en US$ de una llamada, o null si el modelo no tiene precio cargado. */
export function estimateCost(e: Pick<AIUsageEntry, "model" | "input" | "output" | "cacheRead" | "cacheWrite">): number | null {
  const p = PRICES[e.model];
  if (!p) return null;
  return (e.input * p.input + e.cacheWrite * p.input * 1.25 + e.cacheRead * p.cacheRead + e.output * p.output) / 1_000_000;
}
