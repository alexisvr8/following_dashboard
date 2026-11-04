import Link from "next/link";
import { AccountsSplitView } from "@/components/dashboard/AccountsSplitView";
import { WeekPlanner } from "@/components/dashboard/WeekPlanner";
import { KeyNumbers } from "@/components/dashboard/KeyNumbers";
import { FollowupAlerts } from "@/components/dashboard/FollowupAlerts";
import { computeAlerts } from "@/lib/utils/followup-alerts";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { computeWeekPlan, hasWorkLeftThisWeek, planWeekBounds } from "@/lib/utils/week-plan";
import { clientsToBoard } from "@/lib/utils/clients-to-board";

// Datos reales: clientes validados en /clientes (asignados + no asignados) desde
// `.data/clients.json`, leídos en cada request.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const { semana } = await searchParams;
  const { clients, ownerEmail } = await getClientsFile();
  const validated = clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
  const pendingCount = clients.filter((c) => c.status === "pending").length;
  const { accounts, meetings, tickets } = clientsToBoard(validated, new Date(), ownerEmail ?? null);
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

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Resumen de tus cuentas y accionables</p>
      </div>

      {pendingCount > 0 && (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {pendingCount} cliente{pendingCount === 1 ? "" : "s"} sin validar.{" "}
          <Link href="/clientes" className="font-medium text-primary underline-offset-4 hover:underline">
            Revisar en Clientes
          </Link>
        </p>
      )}

      {accounts.length ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Números</h2>
            <KeyNumbers plan={plan} accounts={accounts} tickets={tickets} />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Capacidad</h2>
            <WeekPlanner plan={plan} settings={settings} />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Seguimiento</h2>
            <FollowupAlerts alerts={alerts} staleDays={settings.staleBusinessDays} lastSyncAt={lastSyncAt} />
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">Cuentas</h2>
            <AccountsSplitView accounts={accounts} meetings={meetings} tickets={tickets} />
          </section>
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Todavía no hay clientes validados.{" "}
          <Link href="/clientes" className="font-medium text-primary underline-offset-4 hover:underline">
            Escanea y valida tus clientes
          </Link>{" "}
          para ver métricas reales.
        </div>
      )}
    </div>
  );
}
