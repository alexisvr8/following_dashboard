import { Suspense } from "react";
import Link from "next/link";
import { WeekPlanner } from "@/components/dashboard/WeekPlanner";
import { KeyNumbers } from "@/components/dashboard/KeyNumbers";
import { FollowupAlerts } from "@/components/dashboard/FollowupAlerts";
import type { FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import { computeAlerts, replyQueue } from "@/lib/utils/followup-alerts";
import { getUnassignedMails } from "@/lib/store/unassigned-mail-store";
import { listEventsBetween, type CalendarEventLite } from "@/lib/integrations/calendar";
import { nextMeetings } from "@/lib/utils/deadlines";
import type { ClientRecord } from "@/lib/store/clients-store";
import { getClientsFileCached, getSettingsCached } from "@/lib/server/cached-data";
import type { WorkSettings } from "@/lib/store/settings-store";
import { computeWeekPlan, hasWorkLeftThisWeek, planWeekBounds, type WeekPlan } from "@/lib/utils/week-plan";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { getFollowupDraft, getReminderDraft, getReplyDraft, pendingReplies } from "@/lib/utils/followup";
import type { Account } from "@/types/account";
import type { Ticket } from "@/types/ticket";
import { composerThreads } from "@/lib/utils/followup-thread";
import { meetingsAfterClosure } from "@/lib/utils/closure";

// Datos reales: clientes validados en /clientes (asignados + no asignados), leídos en cada request.
// Supabase (clientes + settings) va en paralelo; Google Calendar (lo más lento) no bloquea: Números y
// Capacidad llegan por streaming (Suspense) y Seguimiento se muestra apenas están los clientes.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const [{ semana }, { clients, ownerEmail }, settings] = await Promise.all([
    searchParams,
    getClientsFileCached(),
    getSettingsCached(),
  ]);
  const validated = clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
  const pendingCount = clients.filter((c) => c.status === "pending").length;
  const reopenHints = clients.filter((c) => meetingsAfterClosure(c).length > 0);
  const { accounts, tickets } = clientsToBoard(validated, new Date(), ownerEmail ?? null);
  // Fin de semana / jornada terminada → por defecto se planifica la semana siguiente.
  const now = new Date();
  const offset = semana === "0" || semana === "1" ? Number(semana) : hasWorkLeftThisWeek(now, settings) ? 0 : 1;
  const { start, end } = planWeekBounds(now, offset);
  // Sin await: la promesa la consumen Números y Capacidad dentro de sus Suspense.
  // Una semana más de eventos: solo para saber la próxima reunión de cada cuenta (preparación).
  // Desde hoy (aunque se planifique la próxima semana): el Pulso de cuentas necesita las reuniones de mañana/pasado.
  const eventsPromise = listEventsBetween(start < now ? start : now, new Date(end.getTime() + 7 * 86_400_000)).catch(() => null);
  const planPromise = eventsPromise.then((weekEvents) => computeWeekPlan(clients, settings, weekEvents, offset, now));
  const lastSyncAt =
    clients.map((c) => c.activity?.syncedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;

  return (
    // ≥1280px: el Dashboard mide exactamente la pantalla (sin scroll de página). Capacidad (2/3) y
    // Seguimiento (1/3) se reparten el alto que queda; solo la lista de mails scrollea. Debajo de
    // 1280px, Seguimiento pasa abajo a todo el ancho y la página scrollea normal.
    <div className="flex w-full flex-col gap-4 p-4 lg:px-6 xl:h-[calc(100dvh-3.6rem)] xl:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3">
        <h1 className="text-lg font-semibold text-foreground-strong">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Resumen de tus cuentas y accionables</p>
      </div>

      {pendingCount > 0 && (
        <p className="shrink-0 rounded-lg border border-dashed border-divider px-4 py-2 text-sm text-muted-foreground">
          <span className="tabular">{pendingCount}</span> cliente{pendingCount === 1 ? "" : "s"} sin validar.{" "}
          <Link href="/clientes" className="font-medium text-foreground-strong underline-offset-4 hover:underline">
            Revisar en Clientes
          </Link>
        </p>
      )}

      {reopenHints.length > 0 && (
        <p className="shrink-0 rounded-lg border border-warning/25 bg-warning-muted px-4 py-2 text-sm text-foreground">
          Reunión nueva en cuenta{reopenHints.length === 1 ? "" : "s"} cerrada{reopenHints.length === 1 ? "" : "s"}:{" "}
          {reopenHints.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link href={`/cuentas/${encodeURIComponent(c.id)}`} className="font-medium text-foreground-strong underline-offset-4 hover:underline">
                {c.name}
              </Link>
            </span>
          ))}
          . ¿Volvió a tu cargo? Reabrila desde la cuenta.
        </p>
      )}

      {accounts.length ? (
        <>
          <section className="shrink-0 space-y-2">
            <h2 className="text-label-sm uppercase text-subtle-foreground">Números</h2>
            <Suspense fallback={<div className="h-24 animate-pulse rounded-xl border border-border bg-card" />}>
              <Numbers plan={planPromise} accounts={accounts} tickets={tickets} />
            </Suspense>
          </section>

          <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
            <section className="min-w-0 xl:min-h-0">
              <Suspense fallback={<div className="h-full min-h-96 animate-pulse rounded-xl border border-border bg-card" />}>
                <Capacity plan={planPromise} settings={settings} />
              </Suspense>
            </section>

            <section className="min-w-0 xl:min-h-0">
              <Suspense fallback={<div className="h-full min-h-96 animate-pulse rounded-xl border border-border bg-card" />}>
                <Pulse
                  events={eventsPromise}
                  clients={clients}
                  ownerEmail={ownerEmail ?? null}
                  settings={settings}
                  now={now}
                  lastSyncAt={lastSyncAt}
                />
              </Suspense>
            </section>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-divider p-8 text-center text-sm text-muted-foreground">
          Todavía no hay clientes validados.{" "}
          <Link href="/clientes" className="font-medium text-foreground-strong underline-offset-4 hover:underline">
            Escanea y valida tus clientes
          </Link>{" "}
          para ver métricas reales.
        </div>
      )}
    </div>
  );
}

async function Numbers({ plan, accounts, tickets }: { plan: Promise<WeekPlan>; accounts: Account[]; tickets: Ticket[] }) {
  return <KeyNumbers plan={await plan} accounts={accounts} tickets={tickets} />;
}

// Pulso de cuentas (Seguimiento): espera Calendar solo para no listar cuentas con reunión en los próximos días.
async function Pulse({
  events,
  clients,
  ownerEmail,
  settings,
  now,
  lastSyncAt,
}: {
  events: Promise<CalendarEventLite[] | null>;
  clients: ClientRecord[];
  ownerEmail: string | null;
  settings: WorkSettings;
  now: Date;
  lastSyncAt: string | null;
}) {
  const alerts = computeAlerts(clients, settings, now, nextMeetings(clients, await events, now));
  // Cuentas activas con pedidos por mail sin resolver: franja aparte, abre Responder.
  const queue = replyQueue(clients, alerts);
  const unassigned = (await getUnassignedMails().catch(() => null))?.items.length ?? 0;
  // Panel inline: borrador (mismo getDraft que /cuentas) + recordatorio + hilo del último mail.
  const panels: Record<string, FollowupPanelData> = {};
  const targets = [
    ...alerts.map((a) => ({ clientId: a.clientId, reply: a.actions.includes("reply") })),
    ...queue.map((q) => ({ clientId: q.clientId, reply: true })),
  ];
  for (const a of targets) {
    const c = clients.find((x) => x.id === a.clientId);
    const latest = c && [...c.meetings].sort((x, y) => y.date.localeCompare(x.date))[0];
    if (!c || !latest) continue;
    panels[a.clientId] = {
      meetingTitle: latest.title,
      draft: getFollowupDraft(c, latest, ownerEmail, settings),
      reminder: getReminderDraft(c, latest, ownerEmail, settings),
      // Responder: solo si el cliente espera respuesta (consultas/pedidos sin contestar).
      ...(a.reply && {
        reply: getReplyDraft(c, latest, ownerEmail, settings),
        replyMail: pendingReplies(c).mails.at(-1) ?? null,
      }),
      threads: composerThreads(c),
      lastMail: c.activity?.lastMail ?? null,
    };
  }
  return <FollowupAlerts alerts={alerts} queue={queue} unassignedCount={unassigned} panels={panels} staleDays={settings.staleBusinessDays} lastSyncAt={lastSyncAt} />;
}

async function Capacity({ plan, settings }: { plan: Promise<WeekPlan>; settings: WorkSettings }) {
  return <WeekPlanner plan={await plan} settings={settings} />;
}
