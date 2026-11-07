"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Ticket } from "@/types/ticket";

export function TicketItem({
  ticket,
  onToggle,
  onSaved,
  meta,
  actions,
  dense = false,
}: {
  /** Fila compacta para listas con divisores (vista Cuentas): texto chico, acciones al pasar el mouse. */
  dense?: boolean;
  ticket: Ticket;
  onToggle?: (ticketId: string, isDone: boolean) => void;
  /** Tras persistir: fecha de cierre registrada por el servidor (null si se reabrió). */
  onSaved?: (ticketId: string, isDone: boolean, doneAt: string | null) => void;
  /** Texto chico a la derecha (p. ej. fecha de finalización). */
  meta?: string;
  /** Botones a la derecha (editar, quitar). Sus clicks no tildan el punto. */
  actions?: React.ReactNode;
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

  if (dense) {
    return (
      <label htmlFor={id} className="group flex items-start gap-2.5 px-2.5 py-2 text-[13px] leading-snug transition-colors hover:bg-surface">
        <Checkbox id={id} checked={isDone} onCheckedChange={(v) => toggle(v === true)} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className={isDone ? "text-subtle-foreground line-through" : "text-foreground"}>{ticket.title}</span>
          {ticket.description && (
            <span className="mt-0.5 block truncate text-[11px] text-subtle-foreground" title={ticket.description}>
              {ticket.description}
            </span>
          )}
        </span>
        {(meta || actions) && (
          <span className="flex shrink-0 items-center gap-1">
            {meta && <span className="text-label-sm text-subtle-foreground">{meta}</span>}
            {actions && (
              <span
                onClick={(e) => e.preventDefault()}
                className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                {actions}
              </span>
            )}
          </span>
        )}
      </label>
    );
  }

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <Checkbox id={id} checked={isDone} onCheckedChange={(v) => toggle(v === true)} />
      <span className="min-w-0">
        <span className={isDone ? "text-muted-foreground" : undefined}>{ticket.title}</span>
        {ticket.description && (
          <span className="block text-[11px] text-muted-foreground">{ticket.description}</span>
        )}
      </span>
      {(meta || actions) && (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {meta && <span className="text-[11px] tabular-nums text-muted-foreground">{meta}</span>}
          {actions && <span onClick={(e) => e.preventDefault()}>{actions}</span>}
        </span>
      )}
    </label>
  );
}
