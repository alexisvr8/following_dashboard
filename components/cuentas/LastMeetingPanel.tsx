"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, ListChecks, Timer, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionablesList } from "@/components/dashboard/ActionablesList";
import { daysAgo, formatMinutes, formatShortDate } from "@/lib/utils/format";
import type { Ticket } from "@/types/ticket";

export function LastMeetingPanel({
  meeting,
  tickets: initialTickets,
  totalMeetings,
  minutes30d,
  clientId,
}: {
  clientId: string;
  meeting: {
    title: string;
    date: string;
    durationMinutes: number | null;
    summary: string | null;
    attendeeCount: number;
  } | null;
  tickets: Ticket[];
  totalMeetings: number;
  minutes30d: number;
}) {
  const router = useRouter();
  const [changes, setChanges] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tras persistir, refresca el server render (regenera el borrador de seguimiento) con debounce.
  function onSaved() {
    setChanges((n) => n + 1);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 800);
  }
  // Estado local para que el engagement reaccione al tildar sin recargar.
  const [done, setDone] = useState(() => new Set(initialTickets.filter((t) => t.isDone).map((t) => t.id)));
  const total = initialTickets.length;
  const percent = total ? Math.round((done.size / total) * 100) : 0;

  function onToggle(id: string, value: boolean) {
    setDone((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">Última reunión</p>
          <CardTitle className="truncate text-base">{meeting?.title ?? "Sin reuniones"}</CardTitle>
          {meeting?.summary && <p className="text-sm text-muted-foreground">{meeting.summary}</p>}
        </div>
        <EngagementRing percent={percent} />
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            icon={CalendarClock}
            label="Fecha"
            value={meeting ? formatShortDate(meeting.date) : "—"}
            hint={meeting ? daysAgo(meeting.date) : undefined}
          />
          <Metric icon={Timer} label="Duración" value={formatMinutes(meeting?.durationMinutes)} hint={`${formatMinutes(minutes30d)} en 30d`} />
          <Metric icon={ListChecks} label="Accionables" value={`${done.size}/${total}`} hint="completados" />
          <Metric icon={Users} label="Participantes" value={String(meeting?.attendeeCount ?? 0)} hint={`${totalMeetings} reuniones (60d)`} />
        </dl>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Engagement</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Accionables</h4>
          <ActionablesList
            tickets={initialTickets}
            onToggle={onToggle}
            onSaved={onSaved}
            emptyText="No se generaron accionables en la última reunión."
          />
          {changes > 0 && (
            <Link
              href={`/cuentas/${encodeURIComponent(clientId)}?borrador=status#borradores`}
              scroll
              className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10"
            >
              Actualizaste accionables: el mail de seguimiento ya se regeneró con lo finalizado y lo faltante
              <ArrowRight className="size-3.5 shrink-0" />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold leading-none">{value}</dd>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EngagementRing({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-16 shrink-0" aria-label={`Engagement ${percent}%`}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{percent}%</span>
    </div>
  );
}
