import { IntegrationsGrid } from "@/components/dashboard/IntegrationsGrid";
import { GET as getGmailStatus } from "@/app/api/integrations/gmail/route";
import { GET as getCalendarStatus } from "@/app/api/integrations/calendar/route";
import { GET as getNotionStatus } from "@/app/api/integrations/notion/route";
import { GET as getXtractStatus } from "@/app/api/integrations/xtract/route";
import { GET as getGeminiNotesStatus } from "@/app/api/integrations/gemini-notes/route";
import type { IntegrationStatus } from "@/types/integration";
import { AIUsageCard } from "@/components/conexiones/AIUsageCard";
import { aiEnabled, postMeetingModel } from "@/lib/llm/postmeeting";
import { getAIUsage } from "@/lib/store/ai-usage-store";
import { summarizeAIUsage } from "@/lib/utils/ai-usage-summary";

// El estado depende de .data/google-tokens.json (archivo local, no cacheable):
// forzamos render dinámico.
export const dynamic = "force-dynamic";

async function loadIntegrations(): Promise<IntegrationStatus[]> {
  const responses = await Promise.all([
    getGmailStatus(),
    getCalendarStatus(),
    getNotionStatus(),
    getXtractStatus(),
    getGeminiNotesStatus(),
  ]);
  return Promise.all(responses.map((r) => r.json()));
}

export default async function ConexionesPage() {
  const [integrations, usage] = await Promise.all([loadIntegrations(), getAIUsage().catch(() => [])]);
  const now = new Date();
  const month = summarizeAIUsage(usage, 30, now);

  return (
    <div className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold">Conexiones</h1>
        <p className="text-sm text-muted-foreground">
          Estado en vivo de las plataformas conectadas (Gmail, Calendar, Notion, Xtract y
          Gemini Notes).
        </p>
      </div>
      <IntegrationsGrid integrations={integrations} />
      <AIUsageCard
        enabled={aiEnabled()}
        model={postMeetingModel()}
        today={month.byDay[now.toLocaleDateString("en-CA")]}
        week={summarizeAIUsage(usage, 7, now)}
        month={month}
      />
    </div>
  );
}
