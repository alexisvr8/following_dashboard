import type { IntegrationStatus } from "@/types/integration";
import { getTokens } from "@/lib/integrations/google-token-store";

export async function GET() {
  const tokens = await getTokens();

  const body: IntegrationStatus = {
    integrationKey: "calendar",
    status: tokens ? "connected" : "not_configured",
    lastSyncedAt: tokens ? new Date(tokens.obtainedAt).toISOString() : null,
    config: {},
  };
  return Response.json(body);
}
