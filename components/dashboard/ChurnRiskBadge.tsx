import { Badge, StatusDot } from "@/components/ui/badge";
import { computeChurnRisk } from "@/lib/utils/churn";
import { cn } from "@/lib/utils";

const LABEL = { green: "Activa", yellow: "Atención", red: "En riesgo" } as const;
const TONE = { green: "success", yellow: "warning", red: "critical" } as const;

/** `size="sm"`: versión chica para listas densas (directorio de Cuentas). */
export function ChurnRiskBadge({ lastActivityAt, size = "default" }: { lastActivityAt: string | null; size?: "default" | "sm" }) {
  const risk = computeChurnRisk(lastActivityAt);
  const sm = size === "sm";
  return (
    <Badge variant={TONE[risk]} className={cn(sm && "h-4 gap-1 rounded-sm px-1 text-[10px] leading-none tracking-normal")}>
      <StatusDot tone={TONE[risk]} className={cn(sm && "size-1")} />
      {LABEL[risk]}
    </Badge>
  );
}
