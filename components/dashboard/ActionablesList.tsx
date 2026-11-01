"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { TicketItem } from "@/components/dashboard/TicketItem";
import type { Ticket } from "@/types/ticket";

// Accionables de una cuenta: pendientes agrupados por la semana de la reunión que los generó
// (lo no finalizado se arrastra) y, aparte, las finalizadas con su fecha para ver el avance.

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "2-digit" });

function weekLabel(weekStart: string, latestWeek: string | undefined): string {
  const d = new Date(`${weekStart}T12:00:00`);
  const label = d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  if (!latestWeek || weekStart === latestWeek) return `Última reunión · semana del ${label}`;
  return weekStart > latestWeek ? `Nuevos (mails) · semana del ${label}` : `Arrastrados · semana del ${label}`;
}

type State = Record<string, { isDone: boolean; doneAt: string | null }>;

export function ActionablesList({
  tickets,
  onToggle,
  onSaved,
  emptyText = "No hay accionables.",
}: {
  tickets: Ticket[];
  onToggle?: (ticketId: string, isDone: boolean) => void;
  onSaved?: (ticketId: string, isDone: boolean) => void;
  emptyText?: string;
}) {
  const [state, setState] = useState<State>({});
  const view = useMemo(
    () =>
      tickets.map((t) => {
        const s = state[t.id];
        return s ? { ...t, isDone: s.isDone, doneAt: s.doneAt } : t;
      }),
    [tickets, state],
  );

  const latestWeek = tickets
    .filter((t) => t.source === "gemini_notes" && !t.carried)
    .map((t) => t.weekStartDate)
    .sort()
    .at(-1);
  const pending = view.filter((t) => !t.isDone);
  const finished = view
    .filter((t) => t.isDone)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const groups = [...new Set(pending.map((t) => t.weekStartDate))].sort().reverse();

  function toggle(id: string, isDone: boolean) {
    setState((prev) => ({
      ...prev,
      [id]: { isDone, doneAt: isDone ? (prev[id]?.doneAt ?? new Date().toISOString()) : null },
    }));
    onToggle?.(id, isDone);
  }

  function saved(id: string, isDone: boolean, doneAt: string | null) {
    setState((prev) => ({ ...prev, [id]: { isDone, doneAt: isDone ? doneAt : null } }));
    onSaved?.(id, isDone);
  }

  if (!tickets.length) return <p className="text-xs text-muted-foreground">{emptyText}</p>;

  return (
    <div className="space-y-4">
      {pending.length ? (
        groups.map((week) => (
          <div key={week} className="space-y-2">
            <h5 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {weekLabel(week, latestWeek)}
            </h5>
            {pending
              .filter((t) => t.weekStartDate === week)
              .map((t) => (
                <TicketItem key={`p-${t.id}`} ticket={t} onToggle={toggle} onSaved={saved} />
              ))}
          </div>
        ))
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-primary" /> Todo finalizado.
        </p>
      )}

      {finished.length > 0 && (
        <div className="space-y-2 rounded-lg border border-dashed bg-muted/30 p-3">
          <h5 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Finalizadas ({finished.length})
          </h5>
          {finished.map((t) => (
            <TicketItem
              key={`d-${t.id}`}
              ticket={t}
              onToggle={toggle}
              onSaved={saved}
              meta={t.doneAt ? fmtDay(t.doneAt) : "sin fecha"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
