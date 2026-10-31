import { Badge } from "@/components/ui/badge";
import { computeChurnRisk } from "@/lib/utils/churn";

const LABEL = { green: "Activa", yellow: "Atención", red: "En riesgo" } as const;

const CLASSNAME = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
  yellow: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 border-transparent",
} as const;

export function ChurnRiskBadge({ lastActivityAt }: { lastActivityAt: string | null }) {
  const risk = computeChurnRisk(lastActivityAt);
  return <Badge className={CLASSNAME[risk]}>{LABEL[risk]}</Badge>;
}
