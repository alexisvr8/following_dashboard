"use client";

import { memo } from "react";
import Link from "next/link";
import { ArrowUpRight, ListChecks, Mail } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { cn } from "@/lib/utils";
import { formatMinutes, formatShortDate } from "@/lib/utils/format";
import type { Account } from "@/types/account";
import type { Meeting } from "@/types/meeting";

export interface TrackingCardData {
  account: Account;
  latestMeeting: Meeting | null;
  engagementPercent: number;
  pending: number;
  total: number;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Cara visible de la card. Se usa en la columna y como overlay flotante al arrastrar. */
export const TrackingCardFace = memo(function TrackingCardFace({
  data,
  lifted = false,
  highlighted = false,
}: {
  data: TrackingCardData;
  lifted?: boolean;
  highlighted?: boolean;
}) {
  const { account, latestMeeting, engagementPercent, pending, total } = data;
  const enc = encodeURIComponent(account.id);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-card p-3 text-left text-sm text-card-foreground ring-1 ring-foreground/10 transition-[box-shadow,ring-color] duration-200",
        !lifted && "hover:shadow-md hover:ring-foreground/20",
        lifted && "shadow-2xl ring-2 ring-primary/40",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium leading-snug">{account.name}</p>
        <ChurnRiskBadge lastActivityAt={account.lastActivityAt} />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {latestMeeting
            ? `${formatShortDate(latestMeeting.meetingDate)} · ${formatMinutes(latestMeeting.durationMinutes)}`
            : "Sin reuniones"}
        </span>
        <span className="tabular-nums">{engagementPercent}%</span>
      </div>
      <Progress value={engagementPercent} className="h-1.5" />

      {account.lastNoteSummary && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{account.lastNoteSummary}</p>
      )}

      <div className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground">
        <ListChecks className="size-3.5" />
        <span className="tabular-nums">{total ? `${pending} pendientes de ${total}` : "Sin accionables"}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <a
            href={`/api/clients/${enc}/last-mail`}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={stop}
            onClick={stop}
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            title="Abrir último mail en Gmail"
            aria-label="Abrir último mail en Gmail"
          >
            <Mail className="size-3.5" />
          </a>
          <Link
            href={`/cuentas/${enc}`}
            onPointerDown={stop}
            onClick={stop}
            className="rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground"
            title="Ver detalle de la cuenta"
            aria-label="Ver detalle de la cuenta"
          >
            <ArrowUpRight className="size-3.5" />
          </Link>
        </span>
      </div>
    </div>
  );
});
