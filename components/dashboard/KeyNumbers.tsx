import { AlertTriangle, BatteryMedium, CalendarDays, CheckCircle2, CircleDashed, ListChecks } from "lucide-react";
import { StatTile } from "@/components/dashboard/StatTile";
import { computeChurnRisk } from "@/lib/utils/churn";
import type { WeekPlan } from "@/lib/utils/week-plan";
import type { Account } from "@/types/account";
import type { Ticket } from "@/types/ticket";

const fmt = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;

// Preview de los 6 números clave. Accionables = última reunión de cada cuenta asignada.
export function KeyNumbers({
  plan,
  accounts,
  tickets,
}: {
  plan: WeekPlan;
  accounts: Account[];
  tickets: Ticket[];
}) {
  const assigned = accounts.filter((a) => a.isAssigned);
  const ids = new Set(assigned.map((a) => a.id));
  const scoped = tickets.filter((t) => ids.has(t.accountId));
  const done = scoped.filter((t) => t.isDone).length;
  const pending = scoped.length - done;
  const atRisk = assigned.filter((a) => computeChurnRisk(a.lastActivityAt) === "red");
  const t = plan.totals;
  const loadTone = t.utilization > 100 ? "danger" : t.utilization >= 85 ? "warning" : "default";

  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        label="Carga de la semana"
        value={`${t.utilization}%`}
        hint={`${fmt(Math.round((t.meetingBusyHours + t.pendingHours) * 10) / 10)} de ${fmt(t.capacityHours)}`}
        icon={BatteryMedium}
        tone={loadTone}
      />
      <StatTile
        label="Reuniones semana"
        value={plan.source === "calendar" ? String(t.meetingCount) : "—"}
        hint={plan.source === "calendar" ? `${t.clientMeetingCount} con clientes · ${t.upcomingCount} por venir` : "Calendar no conectado"}
        icon={CalendarDays}
      />
      <StatTile
        label="Pendientes"
        value={String(pending)}
        hint={scoped.length ? `${Math.round((pending / scoped.length) * 100)}% del total` : undefined}
        icon={CircleDashed}
        tone={scoped.length && pending / scoped.length > 0.5 ? "warning" : "default"}
      />
      <StatTile
        label="Finalizados"
        value={String(done)}
        hint={scoped.length ? `${Math.round((done / scoped.length) * 100)}% del total` : undefined}
        icon={CheckCircle2}
      />
      <StatTile label="Total accionables" value={String(scoped.length)} hint="Últimas reuniones" icon={ListChecks} />
      <StatTile
        label="Riesgo de churn"
        value={String(atRisk.length)}
        hint={atRisk.length ? atRisk.map((a) => a.name).join(", ") : "Ninguna cuenta"}
        icon={AlertTriangle}
        tone={atRisk.length ? "danger" : "default"}
      />
    </div>
  );
}
