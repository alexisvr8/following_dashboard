"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Ticket } from "@/types/ticket";

export function TicketItem({
  ticket,
  onToggle,
  onSaved,
  meta,
}: {
  ticket: Ticket;
  onToggle?: (ticketId: string, isDone: boolean) => void;
  /** Tras persistir: fecha de cierre registrada por el servidor (null si se reabrió). */
  onSaved?: (ticketId: string, isDone: boolean, doneAt: string | null) => void;
  /** Texto chico a la derecha (p. ej. fecha de finalización). */
  meta?: string;
}) {
  // Persiste en `.data/clients.json` (doneTicketIds del cliente). TODO: Supabase.
  const [isDone, setIsDone] = useState(ticket.isDone);
  const id = `ticket-${ticket.id}`;

  function toggle(value: boolean) {
    setIsDone(value);
    onToggle?.(ticket.id, value);
    void fetch(`/api/clients/${encodeURIComponent(ticket.accountId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.id, isDone: value }),
    }).then(async (res) => {
      if (!res.ok) {
        setIsDone(!value);
        onToggle?.(ticket.id, !value);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { doneAt?: string | null };
      onSaved?.(ticket.id, value, data.doneAt ?? null);
    });
  }

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <Checkbox id={id} checked={isDone} onCheckedChange={(v) => toggle(v === true)} />
      <span className="min-w-0">
        <span className={isDone ? "text-muted-foreground line-through" : undefined}>{ticket.title}</span>
        {ticket.description && (
          <span className="block text-[11px] text-muted-foreground">{ticket.description}</span>
        )}
      </span>
      {meta && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{meta}</span>}
    </label>
  );
}
