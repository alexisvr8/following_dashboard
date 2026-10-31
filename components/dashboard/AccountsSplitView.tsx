import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountCard } from "@/components/dashboard/AccountCard";
import type { Account } from "@/types/account";

export function AccountsSplitView({ accounts }: { accounts: Account[] }) {
  const assigned = accounts.filter((a) => a.isAssigned);
  const unassigned = accounts.filter((a) => !a.isAssigned);

  return (
    <Tabs defaultValue="assigned">
      <TabsList>
        <TabsTrigger value="assigned">Asignadas ({assigned.length})</TabsTrigger>
        <TabsTrigger value="unassigned">No asignadas ({unassigned.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="assigned" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {assigned.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </TabsContent>
      <TabsContent value="unassigned" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {unassigned.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </TabsContent>
    </Tabs>
  );
}
