"use client";

import Link from "next/link";
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
import type { Ticket } from "@/types/ticket";

export function TrackingDialog({
  data,
  tickets,
  onClose,
  onMove,
  onToggleTicket,
}: {
  data: TrackingCardData | null;
  tickets: Ticket[];
  onClose: () => void;
  onMove: (id: string, status: TrackingStatus) => void;
  onToggleTicket: (ticketId: string, isDone: boolean) => void;
}) {
  const account = data?.account;
  const meeting = data?.latestMeeting;
  const actionables = account ? tickets.filter((t) => t.accountId === account.id) : [];
  const enc = account ? encodeURIComponent(account.id) : "";

  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {account && (
          <>
            <DialogHeader>
              <DialogTitle>{account.name}</DialogTitle>
              <DialogDescription>
                {meeting
                  ? `Última reunión: ${meeting.title} · ${formatShortDate(meeting.meetingDate)} · ${formatMinutes(meeting.durationMinutes)}`
                  : "Todavía no hay reuniones registradas para esta cuenta."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
              {TRACKING_COLUMNS.map(({ status, label }) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => onMove(account.id, status)}
                  className={cn(
                    "rounded-md px-1.5 py-1.5 text-[11px] leading-tight text-muted-foreground transition-all",
                    account.trackingStatus === status
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                >
                  {label.replace("Tareas ", "")}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Accionables</span>
                <span className="tabular-nums">{data.engagementPercent}% engagement</span>
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                <ActionablesList
                  key={account.id}
                  tickets={actionables}
                  onToggle={onToggleTicket}
                  emptyText="No se generaron accionables en la última reunión."
                />
              </div>
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
                <ArrowUpRight /> Ver cuenta
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
