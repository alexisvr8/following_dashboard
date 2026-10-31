import type { IntegrationStatus } from "@/types/integration";

// TODO Fase 2: leer/escribir integrations_status en Supabase y conectar API real de Notion.
export async function GET() {
  const body: IntegrationStatus = {
    integrationKey: "notion",
    status: "not_configured",
    lastSyncedAt: null,
    config: {},
  };
  return Response.json(body);
}
