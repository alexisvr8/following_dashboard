"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Ticket } from "@/types/ticket";

export function TicketItem({ ticket }: { ticket: Ticket }) {
  // Estado local en Fase 1: sin persistencia. TODO Fase 2: persistir en Supabase.
  const [isDone, setIsDone] = useState(ticket.isDone);
  const id = `ticket-${ticket.id}`;

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <Checkbox id={id} checked={isDone} onCheckedChange={(v) => setIsDone(v === true)} />
      <span className={isDone ? "text-muted-foreground line-through" : undefined}>
        {ticket.title}
      </span>
    </label>
  );
}
