import { IntegrationStatusCard } from "@/components/dashboard/IntegrationStatusCard";
import type { IntegrationStatus } from "@/types/integration";

export function IntegrationsGrid({ integrations }: { integrations: IntegrationStatus[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {integrations.map((integration) => (
        <IntegrationStatusCard key={integration.integrationKey} integration={integration} />
      ))}
    </div>
  );
}
