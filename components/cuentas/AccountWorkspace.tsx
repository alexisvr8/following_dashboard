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

// Espacio de trabajo de la cuenta seleccionada en /cuentas: devuelve DOS columnas del grid de la
// página. Centro = encabezado + franja de engagement + borradores; derecha = contexto operativo en
// pestañas. Comparten el estado local de tildados (el engagement reacciona sin recargar).
export function AccountWorkspace({
  header,
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
  analysis,
}: {
  header: React.ReactNode;
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
  /** Pestaña "Análisis IA" (solo cuentas asignadas). */
  analysis?: React.ReactNode;
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
  // Sin estirar al alto de la columna: cada pestaña mide lo que su contenido.
  const panel = "min-h-0 overflow-y-auto p-px [scrollbar-width:thin]";

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
      <div className="shrink-0 rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">{header}</div>
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
        <EngagementRing percent={percent} />
        <div className="min-w-48 flex-1">
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
      </div>
      {drafts}
      </div>

        <Tabs defaultValue="actions" className="min-h-0 min-w-0">
          <div className="shrink-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
            <TabsList>
              <TabsTrigger value="actions">
                Accionables <span className="tabular text-[11px]">{total - doneCount}</span>
              </TabsTrigger>
              {analysis && <TabsTrigger value="analysis">Análisis IA</TabsTrigger>}
              <TabsTrigger value="trace">Trazabilidad</TabsTrigger>
              <TabsTrigger value="meetings">
                Reuniones <span className="tabular text-[11px]">{totalMeetings}</span>
              </TabsTrigger>
              <TabsTrigger value="people">
                Participantes <span className="tabular text-[11px]">{participantCount}</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="actions" keepMounted className={panel}>
            <Card size="sm">
              <CardContent className="space-y-3">
                <LastChain meeting={meeting && { title: meeting.title, date: meeting.date }} mails={chain} />
                <ActionablesList
                  tickets={tickets}
                  history={history}
                  onToggle={onToggle}
                  onSaved={onSaved}
                  editable={{ clientId, onChanged: () => router.refresh() }}
                  emptyText="No se generaron accionables en la última reunión."
                  dense
                />
                {changes > 0 && (
                  <Link
                    href={`/cuentas/${encodeURIComponent(clientId)}?borrador=status#borradores`}
                    scroll
                    className="flex items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-xs font-medium text-foreground-strong hover:bg-accent"
                  >
                    Actualizaste accionables: el mail de seguimiento ya se regeneró con lo finalizado y lo faltante
                    <ArrowRight className="size-3.5 shrink-0" />
                  </Link>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          {analysis && (
            <TabsContent value="analysis" keepMounted className={panel}>
              {analysis}
            </TabsContent>
          )}
          <TabsContent value="trace" keepMounted className={panel}>
            {trace}
          </TabsContent>
          <TabsContent value="meetings" keepMounted className={panel}>
            {meetingHistory}
          </TabsContent>
          <TabsContent value="people" keepMounted className={panel}>
            {participants}
          </TabsContent>
        </Tabs>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-label-sm uppercase text-subtle-foreground">{label}</dt>
      <dd className="font-mono text-sm font-medium leading-tight text-foreground-strong tabular-nums">
        {value}
        {hint && <span className="ml-1.5 font-sans text-[11px] font-normal text-muted-foreground">{hint}</span>}
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
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-medium tabular-nums">{percent}%</span>
    </div>
  );
}
