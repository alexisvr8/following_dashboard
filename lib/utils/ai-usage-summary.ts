import { estimateCost } from "@/lib/llm/pricing";
import type { AIUsageEntry } from "@/lib/store/ai-usage-store";

// Resumen del registro de consumo de IA (lo usan `GET /api/ai-usage` y la tarjeta de `/conexiones`).
// El costo es ESTIMADO con precios de lista (`lib/llm/pricing.ts`).

export interface UsageBucket {
  calls: number;
  failed: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface UsageSummary {
  days: number;
  total: UsageBucket;
  byKind: Record<string, UsageBucket>;
  byDay: Record<string, UsageBucket>;
  byTrigger: Record<string, UsageBucket>;
  byClient: (UsageBucket & { name: string })[];
  recent: (AIUsageEntry & { costUsd: number | null })[];
}

const empty = (): UsageBucket => ({ calls: 0, failed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

function add(b: UsageBucket, e: AIUsageEntry): void {
  b.calls++;
  if (!e.ok) b.failed++;
  b.input += e.input;
  b.output += e.output;
  b.cacheRead += e.cacheRead;
  b.cacheWrite += e.cacheWrite;
  b.costUsd += estimateCost(e) ?? 0;
}

/** Día local AAAA-MM-DD (respeta `TZ`). */
const localDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

export function summarizeAIUsage(all: AIUsageEntry[], days: number, now = new Date()): UsageSummary {
  const since = now.getTime() - days * 86_400_000;
  const entries = all.filter((e) => Date.parse(e.at) >= since);
  const total = empty();
  const byKind: Record<string, UsageBucket> = {};
  const byDay: Record<string, UsageBucket> = {};
  const byTrigger: Record<string, UsageBucket> = {};
  const byClient: Record<string, UsageBucket & { name: string }> = {};
  for (const e of entries) {
    add(total, e);
    add((byKind[e.kind] ??= empty()), e);
    add((byDay[localDay(e.at)] ??= empty()), e);
    add((byTrigger[e.trigger ?? "sync"] ??= empty()), e);
    const key = e.clientId ?? e.clientName ?? "(sin cuenta)";
    add((byClient[key] ??= { ...empty(), name: e.clientName ?? key }), e);
  }
  return {
    days,
    total,
    byKind,
    byDay,
    byTrigger,
    byClient: Object.values(byClient).sort((a, b) => b.costUsd - a.costUsd),
    recent: entries
      .slice(-50)
      .reverse()
      .map((e) => ({ ...e, costUsd: estimateCost(e) })),
  };
}
