import type { IntegrationStatus } from "@/types/integration";
import { getTokens } from "@/lib/integrations/google-token-store";

// Gemini Notes = minutas de Google Meet guardadas como Doc en Drive; se leen
// con el mismo OAuth de Google usado para Gmail/Calendar (scope drive.readonly).
export async function GET() {
  const tokens = await getTokens();
  const hasDriveScope = tokens?.scope.includes("drive.readonly") ?? false;

  const body: IntegrationStatus = {
    integrationKey: "gemini_notes",
    status: hasDriveScope ? "connected" : "not_configured",
    lastSyncedAt: hasDriveScope && tokens ? new Date(tokens.obtainedAt).toISOString() : null,
    config: {},
  };
  return Response.json(body);
}
