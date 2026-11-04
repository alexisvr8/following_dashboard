"use client";

import { memo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, Mail } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { daysAgo, formatShortDate } from "@/lib/utils/format";
import { shortStep, type BoardCard } from "@/lib/utils/board-status";
import type { TrackingStatus } from "@/types/account";
import type { Ticket } from "@/types/ticket";

export interface TrackingCardData {
  card: BoardCard;
  status: TrackingStatus;
  tickets: Ticket[];
  done: number;
  total: number;
  percent: number;
  /** null si no está finalizada. */
  closedAt: string | null;
  priorityReason: string | null;
}

const PREVIEW = 3;
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const stopAll = { onPointerDown: stop, onClick: stop, onKeyDown: stop };

/** Cara visible de la card. Se usa en la columna y como overlay flotante al arrastrar. */
export const TrackingCardFace = memo(function TrackingCardFace({
  data,
  lifted = false,
  highlighted = false,
  onToggle,
}: {
  data: TrackingCardData;
  lifted?: boolean;
  highlighted?: boolean;
  onToggle?: (ticket: Ticket, isDone: boolean) => void;
}) {
  const { card, status, tickets, done, total, percent, closedAt, priorityReason } = data;
  const enc = encodeURIComponent(card.accountId);
  const frame = cn(
    "rounded-xl bg-card text-left text-sm text-card-foreground ring-1 ring-foreground/10 transition-[box-shadow,ring-color] duration-200",
    !lifted && "hover:shadow-md hover:ring-foreground/20",
    lifted && "shadow-2xl ring-2 ring-primary/40",
    highlighted && "ring-2 ring-primary",
  );

  // Finalizadas: una línea. Lo cerrado queda a mano sin competir con lo que falta hacer.
  if (status === "tasks_done") {
    return (
      <div className={cn(frame, "flex items-center gap-2 px-3 py-2")} title={`${card.accountName} · ${card.title}`}>
        <CheckCircle2 className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{card.accountName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{card.title}</p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {done < total ? `${done}/${total} · ` : ""}
          {closedAt ? formatShortDate(closedAt) : ""}
        </span>
      </div>
    );
  }

  const open = tickets.filter((t) => !t.isDone);
  // Primero lo mío: lo del cliente depende de otro.
  const sorted = [...open].sort((a, b) => Number(!!card.otherOwners[a.id]) - Number(!!card.otherOwners[b.id]));
  const preview = sorted.slice(0, PREVIEW);
  const KindIcon = card.kind === "mail" ? Mail : CalendarClock;

  return (
    <div className={cn(frame, "flex flex-col gap-3 p-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-snug">{card.accountName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground" title={card.title}>
            <KindIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{card.title}</span>
            {card.sources.length > 1 && (
              <span
                className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px]"
                title={card.sources.map((s) => s.title).join(" · ")}
              >
                +{card.sources.length - 1}
              </span>
            )}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <a
            href={`/api/clients/${enc}/last-mail`}
            target="_blank"
            rel="noopener noreferrer"
            {...stopAll}
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            title="Abrir último mail en Gmail"
            aria-label="Abrir último mail en Gmail"
          >
            <Mail className="size-3.5" />
          </a>
          <Link
            href={`/cuentas/${enc}`}
            {...stopAll}
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            title="Ver detalle de la cuenta"
            aria-label="Ver detalle de la cuenta"
          >
            <ArrowUpRight className="size-3.5" />
          </Link>
        </span>
      </div>

      {status === "tasks_priority" && priorityReason && (
        <p className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0">{priorityReason}</span>
        </p>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {formatShortDate(card.date)} · {daysAgo(card.date)}
          </span>
          <span className="tabular-nums">
            {done}/{total} puntos
          </span>
        </div>
        <Progress value={percent} className="h-1.5" />
      </div>

      {preview.length > 0 && (
        <ul className="space-y-1.5">
          {preview.map((t) => (
            <li key={t.id} {...stopAll}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md text-xs hover:text-foreground">
                <Checkbox
                  checked={t.isDone}
                  disabled={!onToggle}
                  onCheckedChange={(v) => onToggle?.(t, v === true)}
                  className="mt-px"
                  aria-label={`Marcar: ${t.title}`}
                />
                <span className="min-w-0 flex-1 line-clamp-2" title={t.title}>
                  {shortStep(t.title)}
                </span>
                {card.otherOwners[t.id] && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                    {card.otherOwners[t.id]}
                  </span>
                )}
              </label>
            </li>
          ))}
          {open.length > PREVIEW && (
            <li className="pl-6 text-[11px] text-muted-foreground">y {open.length - PREVIEW} más…</li>
          )}
        </ul>
      )}
    </div>
  );
});
