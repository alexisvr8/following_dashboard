import Link from "next/link";
import { WeekPlanner } from "@/components/dashboard/WeekPlanner";
import { KeyNumbers } from "@/components/dashboard/KeyNumbers";
import { FollowupAlerts } from "@/components/dashboard/FollowupAlerts";
import type { FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import { computeAlerts } from "@/lib/utils/followup-alerts";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { computeWeekPlan, hasWorkLeftThisWeek, planWeekBounds } from "@/lib/utils/week-plan";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { getDraft } from "@/lib/utils/followup";

// Datos reales: clientes validados en /clientes (asignados + no asignados) desde
// `.data/clients.json`, leídos en cada request. Las cuentas viven en /cuentas.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const { semana } = await searchParams;
  const { clients, ownerEmail } = await getClientsFile();
  const validated = clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
  const pendingCount = clients.filter((c) => c.status === "pending").length;
  const { accounts, tickets } = clientsToBoard(validated, new Date(), ownerEmail ?? null);
  const settings = await getSettings();
  // Fin de semana / jornada terminada → por defecto se planifica la semana siguiente.
  const now = new Date();
  const offset = semana === "0" || semana === "1" ? Number(semana) : hasWorkLeftThisWeek(now, settings) ? 0 : 1;
  const { start, end } = planWeekBounds(now, offset);
  const weekEvents = await listEventsBetween(start, end).catch(() => null);
  const plan = computeWeekPlan(clients, settings, weekEvents, offset, now);
  const alerts = computeAlerts(clients, settings, now);
  const lastSyncAt =
    clients.map((c) => c.activity?.syncedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;

  // Panel inline de Seguimiento: borrador de actualización (mismo getDraft que /cuentas) + hilo del último mail.
  const panels: Record<string, FollowupPanelData> = {};
  for (const a of alerts) {
    const c = clients.find((x) => x.id === a.clientId);
    const latest = c && [...c.meetings].sort((x, y) => y.date.localeCompare(x.date))[0];
    if (!c || !latest) continue;
    panels[a.clientId] = {
      meetingTitle: latest.title,
      draft: getDraft("status", c, latest, ownerEmail ?? null, settings),
      threads: c.activity?.threads ?? [],
      lastMail: c.activity?.lastMail ?? null,
    };
  }

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

      {accounts.length ? (
        <>
          <section className="shrink-0 space-y-2">
            <h2 className="text-label-sm uppercase text-subtle-foreground">Números</h2>
            <KeyNumbers plan={plan} accounts={accounts} tickets={tickets} />
          </section>

          <div className="grid gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
            <section className="min-w-0 xl:min-h-0">
              <WeekPlanner plan={plan} settings={settings} />
            </section>

            <section className="min-w-0 xl:min-h-0">
              <FollowupAlerts
                alerts={alerts}
                panels={panels}
                staleDays={settings.staleBusinessDays}
                lastSyncAt={lastSyncAt}
              />
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
