import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import type { IntegrationStatus } from "@/types/integration";

const LABEL: Record<IntegrationStatus["integrationKey"], string> = {
  gmail: "Gmail Corporativo",
  calendar: "Google Calendar",
  notion: "Notion",
  xtract: "Xtract (historial 90 días)",
  gemini_notes: "Gemini Notes",
};

const STATUS_LABEL: Record<IntegrationStatus["status"], string> = {
  not_configured: "No configurado",
  connected: "Conectado",
  error: "Error",
};

const STATUS_TONE = { connected: "success", error: "critical", not_configured: "outline" } as const;

export function IntegrationStatusCard({ integration }: { integration: IntegrationStatus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{LABEL[integration.integrationKey]}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
        <Badge variant={STATUS_TONE[integration.status]}>
          {integration.status !== "not_configured" && <StatusDot tone={STATUS_TONE[integration.status] as "success" | "critical"} />}
          {STATUS_LABEL[integration.status]}
        </Badge>
        <span className="tabular">{integration.lastSyncedAt ? `Última sync: ${integration.lastSyncedAt}` : "Sin sincronizar"}</span>
      </CardContent>
    </Card>
  );
}
