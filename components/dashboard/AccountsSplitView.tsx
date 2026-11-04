"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountCard } from "@/components/dashboard/AccountCard";
import { getLatestMeeting } from "@/lib/utils/meetings";
import type { Account } from "@/types/account";
import type { Meeting } from "@/types/meeting";
import type { Ticket } from "@/types/ticket";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Más reciente primero; sin movimiento al final; desempate por nombre. */
function byMovement(a: Account, b: Account): number {
  const at = (x: Account) => (x.lastMovementAt ? Date.parse(x.lastMovementAt) : 0);
  return at(b) - at(a) || a.name.localeCompare(b.name, "es");
}

function movementBucket(iso: string | null | undefined, now: Date): string {
  if (!iso) return "Anteriores";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  // Lunes de esta semana = hace (getDay + 6) % 7 días.
  return diff <= (today.getDay() + 6) % 7 ? "Esta semana" : "Anteriores";
}

export function AccountsSplitView({
  accounts,
  meetings,
  tickets,
}: {
  accounts: Account[];
  meetings: Meeting[];
  tickets: Ticket[];
}) {
  const [query, setQuery] = useState("");
  const q = norm(query.trim());
  const visible = (q ? accounts.filter((a) => norm(`${a.name} ${a.id} ${a.erp ?? ""}`).includes(q)) : accounts)
    .slice()
    .sort(byMovement);
  const assigned = visible.filter((a) => a.isAssigned);
  const unassigned = visible.filter((a) => !a.isAssigned);

  const renderCard = (account: Account) => {
    const latestMeeting = getLatestMeeting(account.id, meetings);
    const latestTickets = tickets.filter((t) => t.accountId === account.id);
    return (
      <AccountCard
        key={account.id}
        account={account}
        latestMeeting={latestMeeting}
        meetingCount={meetings.filter((m) => m.accountId === account.id).length}
        actionablesDefined={latestTickets.length}
        pendingActionables={latestTickets.filter((t) => !t.isDone).length}
      />
    );
  };

  // Títulos por antigüedad del último movimiento; al buscar se muestra la lista corrida.
  const renderList = (list: Account[]) => {
    if (!list.length) return q ? empty : null;
    if (q) return list.map(renderCard);
    const now = new Date();
    return list.flatMap((account, i) => {
      const bucket = movementBucket(account.lastMovementAt, now);
      const isNew = i === 0 || movementBucket(list[i - 1].lastMovementAt, now) !== bucket;
      return [
        ...(isNew
          ? [
              <h3 key={`h-${bucket}`} className="col-span-full pt-2 text-xs font-medium text-muted-foreground first:pt-0">
                {bucket}
              </h3>,
            ]
          : []),
        renderCard(account),
      ];
    });
  };

  const empty = (
    <p className="col-span-full rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      Ninguna cuenta coincide con “{query}”.
    </p>
  );

  return (
    <Tabs defaultValue="assigned">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="assigned">Asignadas ({assigned.length})</TabsTrigger>
          <TabsTrigger value="unassigned">No asignadas ({unassigned.length})</TabsTrigger>
        </TabsList>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cuenta, dominio o ERP…"
            aria-label="Buscar cuenta"
            className="h-9 w-full rounded-lg border border-input bg-transparent pl-8 pr-8 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      <TabsContent value="assigned" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {renderList(assigned)}
      </TabsContent>
      <TabsContent value="unassigned" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {renderList(unassigned)}
      </TabsContent>
    </Tabs>
  );
}
