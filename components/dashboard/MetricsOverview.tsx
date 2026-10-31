import { Users, AlertTriangle, Gauge, Clock } from "lucide-react";
import { StatTile } from "@/components/dashboard/StatTile";
import { computeChurnRisk } from "@/lib/utils/churn";
import type { Account } from "@/types/account";

export function MetricsOverview({ accounts }: { accounts: Account[] }) {
  const assigned = accounts.filter((a) => a.isAssigned);
  const atRisk = assigned.filter((a) => computeChurnRisk(a.lastActivityAt) === "red");
  const avgEngagement = assigned.length
    ? Math.round(
        assigned.reduce((sum, a) => sum + (a.engagementPercent ?? 0), 0) / assigned.length,
      )
    : 0;
  const plannedHours = assigned.reduce((sum, a) => sum + a.calendarMinutesPlanned, 0) / 60;
  const actualHours = assigned.reduce((sum, a) => sum + a.executionMinutesActual, 0) / 60;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Cuentas asignadas" value={String(assigned.length)} icon={Users} />
      <StatTile
        label="En riesgo de churn"
        value={String(atRisk.length)}
        hint={atRisk.length ? atRisk.map((a) => a.name).join(", ") : "Ninguna"}
        icon={AlertTriangle}
        tone={atRisk.length ? "danger" : "default"}
      />
      <StatTile label="Engagement promedio" value={`${avgEngagement}%`} icon={Gauge} />
      <StatTile
        label="Tiempo dedicado"
        value={`${actualHours.toFixed(1)}h`}
        hint={`de ${plannedHours.toFixed(1)}h planeadas`}
        icon={Clock}
        tone={actualHours < plannedHours * 0.7 ? "warning" : "default"}
      />
    </div>
  );
}
