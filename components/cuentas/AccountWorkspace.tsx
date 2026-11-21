"use client";

import { createContext, useContext, useRef, useState } from "react";
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

type Engagement = { percent: number; detail: string };
const EngagementContext = createContext<Engagement | null>(null);

// Espacio de trabajo de la cuenta seleccionada en /cuentas: devuelve DOS columnas del grid de la
// página. Centro = encabezado (con el chip de engagement junto al nombre, `EngagementChip`) + borradores;
// derecha = contexto operativo en pestañas. Comparten el estado local de tildados (el engagement reacciona
// sin recargar). Los datos de la última reunión quedan en el tooltip del chip (y en la pestaña Reuniones).
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
  onBoard = false,
}: {
  /** Cuenta asignada: sus pendientes tienen card en /accionables (acceso directo "Ver en tablero"). */
  onBoard?: boolean;
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

  const engagement: Engagement = {
    percent,
    detail: [
      `Engagement ${percent}% · ${doneCount}/${total} accionables completados`,
      meeting
        ? `Última reunión: “${meeting.title}” · ${formatShortDate(meeting.date)} (${daysAgo(meeting.date)}) · ${formatMinutes(meeting.durationMinutes)} · ${meeting.attendeeCount} participantes`
        : "Sin reuniones",
      `${totalMeetings} reuniones en 60 días · ${formatMinutes(minutes30d)} en 30 días`,
    ].join("\n"),
  };

  return (
    <EngagementContext.Provider value={engagement}>
      <div className="flex min-h-0 min-w-0 flex-col gap-4 short:gap-2.5 lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
      <div className="shrink-0 rounded-xl border border-border bg-card">
      <div className="px-4 py-3 short:py-2">{header}</div>
      {/* Pantallas bajas (`short`): una sola línea de info general, sin resumen ni detalle de cada métrica. */}
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
                  boardLink={onBoard}
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
    </EngagementContext.Provider>
  );
}

/** Chip junto al nombre de la cuenta: anillo + %; el detalle (accionables, última reunión) va en el tooltip. */
export function EngagementChip() {
  const e = useContext(EngagementContext);
  if (!e) return null;
  return (
    <span
      title={e.detail}
      aria-label={e.detail}
      className="inline-flex h-5 shrink-0 cursor-help items-center gap-1 rounded-md border border-input bg-card pr-1.5 pl-0.5 text-label-sm text-muted-foreground"
    >
      <EngagementRing percent={e.percent} />
      <span className="tabular font-medium text-foreground-strong">{e.percent}%</span>
    </span>
  );
}

function EngagementRing({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-4 shrink-0" aria-hidden>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="9" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
        />
      </svg>
    </div>
  );
}
