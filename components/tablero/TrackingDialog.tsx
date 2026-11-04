"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { ActionablesList } from "@/components/dashboard/ActionablesList";
import { TRACKING_COLUMNS } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { formatMinutes, formatShortDate } from "@/lib/utils/format";
import type { TrackingCardData } from "@/components/tablero/TrackingCard";
import type { TrackingStatus } from "@/types/account";

export function TrackingDialog({
  data,
  onClose,
  onMove,
  onToggleTicket,
}: {
  data: TrackingCardData | null;
  onClose: () => void;
  onMove: (id: string, status: TrackingStatus) => void;
  onToggleTicket: (ticketId: string, isDone: boolean) => void;
}) {
  const router = useRouter();
  const card = data?.card;
  const enc = card ? encodeURIComponent(card.accountId) : "";

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {card && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{card.accountName}</DialogTitle>
              <DialogDescription>
                {card.kind === "mail" ? "Mail" : "Reunión"}: {card.title} · {formatShortDate(card.date)}
                {card.durationMinutes ? ` · ${formatMinutes(card.durationMinutes)}` : ""}
                {card.sources.length > 1 && ` · junta ${card.sources.length} reuniones o mails`}
                {card.summary && <span className="mt-1 block">{card.summary}</span>}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
              {TRACKING_COLUMNS.map(({ status, label, hint }) => (
                <button
                  key={status}
                  type="button"
                  title={hint}
                  onClick={() => onMove(card.id, status)}
                  className={cn(
                    "rounded-md px-1.5 py-1.5 text-xs leading-tight text-muted-foreground transition-all",
                    data.status === status ? "bg-background font-medium text-foreground shadow-sm" : "hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-px [scrollbar-width:thin]">
              <ActionablesList
                key={card.id}
                bySource
                tickets={data.tickets}
                onToggle={onToggleTicket}
                editable={{ clientId: card.accountId, onChanged: () => router.refresh() }}
                emptyText="Esta card no tiene puntos."
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <a
                href={`/api/clients/${enc}/last-mail`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Mail /> Último mail
              </a>
              <Link href={`/cuentas/${enc}`} className={buttonVariants({ size: "sm" })}>
                <ArrowUpRight /> Ver cuenta y borradores
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Finalizadas de semanas anteriores: fuera del tablero, a un click para consultarlas o reabrirlas. */
export function ArchiveDialog({
  open,
  cards,
  onClose,
  onOpenCard,
}: {
  open: boolean;
  cards: TrackingCardData[];
  onClose: () => void;
  onOpenCard: (id: string) => void;
}) {
  const sorted = [...cards].sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Archivo de finalizadas</DialogTitle>
          <DialogDescription>
            Cards cerradas antes de esta semana. Abrí una para ver sus puntos o desmarcar alguno: si la reabrís, vuelve al tablero.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] divide-y overflow-y-auto text-sm [scrollbar-width:thin]">
          {sorted.map(({ card, closedAt, total }) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => onOpenCard(card.id)}
                className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{card.accountName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{card.title}</span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {closedAt ? formatShortDate(closedAt) : ""}
                  <span className="block">{total} puntos</span>
                </span>
              </button>
            </li>
          ))}
          {!sorted.length && <li className="py-6 text-center text-xs text-muted-foreground">Todavía no hay cards archivadas.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
