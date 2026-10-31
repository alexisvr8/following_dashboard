import type { IntegrationStatus } from "@/types/integration";

// TODO Fase 2: leer/escribir integrations_status en Supabase y conectar OAuth real de Google Calendar.
export async function GET() {
  const body: IntegrationStatus = {
    integrationKey: "calendar",
    status: "not_configured",
    lastSyncedAt: null,
    config: {},
  };
  return Response.json(body);
}
