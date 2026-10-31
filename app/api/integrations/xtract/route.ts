import type { IntegrationStatus } from "@/types/integration";

// TODO Fase 2: leer historial y status de 90 días desde el sistema Xtract real.
export async function GET() {
  const body: IntegrationStatus = {
    integrationKey: "xtract",
    status: "not_configured",
    lastSyncedAt: null,
    config: { historyWindowDays: 90 },
  };
  return Response.json(body);
}
