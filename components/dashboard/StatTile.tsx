import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONE_CLASSNAME = {
  default: "border-input bg-surface text-muted-foreground",
  warning: "border-warning/25 bg-warning-muted text-warning",
  danger: "border-critical/25 bg-critical-muted text-critical",
} as const;

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE_CLASSNAME;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-label-sm uppercase text-subtle-foreground">{label}</p>
          <p className="font-mono text-xl font-medium tracking-tight text-foreground-strong tabular-nums">{value}</p>
          {hint && <p className="truncate text-xs text-muted-foreground" title={hint}>{hint}</p>}
        </div>
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", TONE_CLASSNAME[tone])}>
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}
