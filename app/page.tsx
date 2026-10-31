import { MetricsOverview } from "@/components/dashboard/MetricsOverview";
import { AccountsSplitView } from "@/components/dashboard/AccountsSplitView";
import { WeeklyTicketList } from "@/components/dashboard/WeeklyTicketList";
import { IntegrationsGrid } from "@/components/dashboard/IntegrationsGrid";
import { mockAccounts } from "@/lib/mock/accounts";
import { mockTickets } from "@/lib/mock/tickets";
import { mockIntegrations } from "@/lib/mock/integrations";
import { computeEngagementPercent } from "@/lib/utils/engagement";

export default function Home() {
  const accounts = mockAccounts.map((account) => ({
    ...account,
    engagementPercent: computeEngagementPercent(
      mockTickets.filter((t) => t.accountId === account.id),
    ),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Resumen de tus cuentas y accionables</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Métricas</h2>
        <MetricsOverview accounts={accounts} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Cuentas</h2>
        <AccountsSplitView accounts={accounts} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Tickets / Accionables</h2>
        <WeeklyTicketList tickets={mockTickets} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Integraciones</h2>
        <IntegrationsGrid integrations={mockIntegrations} />
      </section>
    </div>
  );
}
