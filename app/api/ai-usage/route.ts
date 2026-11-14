import { getAIUsage } from "@/lib/store/ai-usage-store";
import { summarizeAIUsage } from "@/lib/utils/ai-usage-summary";

// Consumo de IA registrado (`lib/store/ai-usage-store.ts`). GET ?days=30 (1–120): totales, por tipo, por día,
// por origen, por cuenta y las últimas 50 llamadas. El costo es ESTIMADO (`lib/llm/pricing.ts`).

export async function GET(request: Request) {
  const days = Math.min(120, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
  return Response.json({
    note: "Costo estimado con precios de lista; la factura real está en console.anthropic.com.",
    ...summarizeAIUsage(await getAIUsage(), days),
  });
}
