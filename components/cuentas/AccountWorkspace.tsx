"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionablesList } from "@/components/dashboard/ActionablesList";
import { LastChain } from "@/components/cuentas/LastChain";
import { daysAgo, formatMinutes, formatShortDate } from "@/lib/utils/format";
import type { MailRef } from "@/lib/store/clients-store";
import type { ExecutedEntry } from "@/lib/utils/actionables";
import type { Ticket } from "@/types/ticket";

// Espacio de trabajo de la cuenta. En escritorio entra en una pantalla: resumen de la última reunión
// arriba, borradores a la izquierda y el resto en pestañas a la derecha, cada columna con su scroll.
export function AccountWorkspace({
  clientId,
  meeting,
  tickets,
  history,
  chain,
  totalMeetings,
  minutes30d,
  participantCount,
  drafts,
  trace,
  participants,
  meetingHistory,
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
  history: ExecutedEntry[];
  chain: MailRef[];
  totalMeetings: number;
  minutes30d: number;
  participantCount: number;
  drafts: React.ReactNode;
  trace: React.ReactNode;
  participants: React.ReactNode;
  meetingHistory: React.ReactNode;
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
  const [done, setDone] = useState(() => new Set(tickets.filter((t) => t.isDone).map((t) => t.id)));
  const total = tickets.length;
  const doneCount = tickets.filter((t) => done.has(t.id)).length;
  const percent = total ? Math.round((doneCount / total) * 100) : 0;

  function onToggle(id: string, value: boolean) {
    setDone((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // keepMounted: al cambiar de pestaña no se pierde lo tildado ni lo desplegado.
  const panel = "min-h-0 overflow-y-auto p-px [scrollbar-width:thin] lg:[&>*]:min-h-full";

  return (
    <>
      <section className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-card px-4 py-2.5 ring-1 ring-foreground/10">
        <EngagementRing percent={percent} />
        <div className="min-w-60 flex-1">
          <p className="truncate text-sm font-medium" title={meeting?.title}>
            {meeting?.title ?? "Sin reuniones"}
          </p>
          {meeting?.summary && (
            <p className="line-clamp-2 text-xs text-muted-foreground" title={meeting.summary}>
              {meeting.summary}
            </p>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <Metric label="Fecha" value={meeting ? formatShortDate(meeting.date) : "—"} hint={meeting ? daysAgo(meeting.date) : undefined} />
          <Metric label="Duración" value={formatMinutes(meeting?.durationMinutes)} hint={`${formatMinutes(minutes30d)} en 30d`} />
          <Metric label="Accionables" value={`${doneCount}/${total}`} hint="completados" />
          <Metric label="Participantes" value={String(meeting?.attendeeCount ?? 0)} hint={`${totalMeetings} reuniones (60d)`} />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:min-h-[520px] lg:flex-1 lg:grid-cols-2">
        <div className="flex min-h-0 min-w-0 flex-col">{drafts}</div>

        <Tabs defaultValue="actions" className="min-h-0 min-w-0">
          <div className="shrink-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
            <TabsList>
              <TabsTrigger value="actions">Accionables ({total - doneCount})</TabsTrigger>
              <TabsTrigger value="trace">Trazabilidad</TabsTrigger>
              <TabsTrigger value="people">Participantes ({participantCount})</TabsTrigger>
              <TabsTrigger value="meetings">Reuniones ({totalMeetings})</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="actions" keepMounted className={panel}>
            <Card>
              <CardContent className="space-y-4">
                <LastChain meeting={meeting && { title: meeting.title, date: meeting.date }} mails={chain} />
                <ActionablesList
                  tickets={tickets}
                  history={history}
                  onToggle={onToggle}
                  onSaved={onSaved}
                  editable={{ clientId, onChanged: () => router.refresh() }}
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
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="trace" keepMounted className={panel}>
            {trace}
          </TabsContent>
          <TabsContent value="people" keepMounted className={panel}>
            {participants}
          </TabsContent>
          <TabsContent value="meetings" keepMounted className={panel}>
            {meetingHistory}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold leading-tight">
        {value}
        {hint && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

function EngagementRing({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-11 shrink-0" role="img" aria-label={`Engagement ${percent}%`} title={`Engagement ${percent}%`}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">{percent}%</span>
    </div>
  );
}
