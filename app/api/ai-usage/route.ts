import { estimateCost } from "@/lib/llm/pricing";
import { getAIUsage, type AIUsageEntry } from "@/lib/store/ai-usage-store";

// Consumo de IA registrado (`lib/store/ai-usage-store.ts`). GET ?days=30 (1–120): totales, por tipo, por día,
// por cuenta y las últimas 50 llamadas. El costo es ESTIMADO con precios de lista (`lib/llm/pricing.ts`).

interface Bucket {
  calls: number;
  failed: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

const empty = (): Bucket => ({ calls: 0, failed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

function add(b: Bucket, e: AIUsageEntry): void {
  b.calls++;
  if (!e.ok) b.failed++;
  b.input += e.input;
  b.output += e.output;
  b.cacheRead += e.cacheRead;
  b.cacheWrite += e.cacheWrite;
  b.costUsd += estimateCost(e) ?? 0;
}

const round = (b: Bucket): Bucket => ({ ...b, costUsd: Math.round(b.costUsd * 10_000) / 10_000 });

export async function GET(request: Request) {
  const days = Math.min(120, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  const since = Date.now() - days * 86_400_000;
  const entries = (await getAIUsage()).filter((e) => Date.parse(e.at) >= since);

  const total = empty();
  const byKind: Record<string, Bucket> = {};
  const byDay: Record<string, Bucket> = {};
  const byClient: Record<string, Bucket & { name: string }> = {};
  for (const e of entries) {
    add(total, e);
    add((byKind[e.kind] ??= empty()), e);
    add((byDay[e.at.slice(0, 10)] ??= empty()), e);
    const key = e.clientId ?? e.clientName ?? "(sin cuenta)";
    add((byClient[key] ??= { ...empty(), name: e.clientName ?? key }), e);
  }
  const map = <T extends Bucket>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)]));

  return Response.json({
    days,
    note: "Costo estimado con precios de lista; la factura real está en console.anthropic.com.",
    total: round(total),
    byKind: map(byKind),
    byDay: map(byDay),
    byClient: Object.values(byClient)
      .map(round)
      .sort((a, b) => b.costUsd - a.costUsd),
    recent: entries
      .slice(-50)
      .reverse()
      .map((e) => ({ ...e, costUsd: estimateCost(e) })),
  });
}
