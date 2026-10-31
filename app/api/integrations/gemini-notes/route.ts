import type { IntegrationStatus } from "@/types/integration";

// TODO Fase 2: validar reuniones reales contra Gemini Notes.
export async function GET() {
  const body: IntegrationStatus = {
    integrationKey: "gemini_notes",
    status: "not_configured",
    lastSyncedAt: null,
    config: {},
  };
  return Response.json(body);
}
