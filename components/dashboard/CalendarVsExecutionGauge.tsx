import { Progress } from "@/components/ui/progress";

export function CalendarVsExecutionGauge({
  plannedMinutes,
  actualMinutes,
}: {
  plannedMinutes: number;
  actualMinutes: number;
}) {
  const max = Math.max(plannedMinutes, actualMinutes, 1);
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Bloqueado en calendario</span>
          <span>{plannedMinutes}m</span>
        </div>
        <Progress value={(plannedMinutes / max) * 100} />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Ejecución real</span>
          <span>{actualMinutes}m</span>
        </div>
        <Progress value={(actualMinutes / max) * 100} />
      </div>
    </div>
  );
}
