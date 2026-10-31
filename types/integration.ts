export type IntegrationKey =
  | "gmail"
  | "calendar"
  | "notion"
  | "xtract"
  | "gemini_notes";

export type IntegrationConnectionStatus = "not_configured" | "connected" | "error";

export interface IntegrationStatus {
  integrationKey: IntegrationKey;
  status: IntegrationConnectionStatus;
  lastSyncedAt: string | null;
  config: Record<string, unknown>;
}
