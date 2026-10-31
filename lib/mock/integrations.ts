import type { IntegrationStatus } from "@/types/integration";

export const mockIntegrations: IntegrationStatus[] = [
  { integrationKey: "gmail", status: "not_configured", lastSyncedAt: null, config: {} },
  { integrationKey: "calendar", status: "not_configured", lastSyncedAt: null, config: {} },
  { integrationKey: "notion", status: "not_configured", lastSyncedAt: null, config: {} },
  { integrationKey: "xtract", status: "not_configured", lastSyncedAt: null, config: {} },
  { integrationKey: "gemini_notes", status: "not_configured", lastSyncedAt: null, config: {} },
];
