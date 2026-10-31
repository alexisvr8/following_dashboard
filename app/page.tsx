import { AccountsSplitView } from "@/components/dashboard/AccountsSplitView";
import { mockAccounts } from "@/lib/mock/accounts";
import { mockTickets } from "@/lib/mock/tickets";
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
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">Cuentas</h2>
        <AccountsSplitView accounts={accounts} />
      </section>
    </div>
  );
}
