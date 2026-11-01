import type { IntegrationStatus } from "@/types/integration";
import { getNotionTokens } from "@/lib/integrations/notion-token-store";
import { getAccountsDbSchema, hasAccountsDb, isNotionConnected } from "@/lib/integrations/notion";

export async function GET() {
  let status: IntegrationStatus["status"] = "not_configured";
  const config: Record<string, unknown> = {};

  if (await isNotionConnected()) {
    status = "connected";
    config.workspace = (await getNotionTokens())?.workspaceName ?? null;
    if (hasAccountsDb()) {
      try {
        config.database = (await getAccountsDbSchema()).title;
      } catch (error) {
        status = "error";
        config.error = (error as Error).message;
      }
    }
  }

  const body: IntegrationStatus = {
    integrationKey: "notion",
    status,
    lastSyncedAt: status === "connected" ? new Date().toISOString() : null,
    config,
  };
  return Response.json(body);
}
