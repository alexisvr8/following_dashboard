import { Progress } from "@/components/ui/progress";

export function EngagementBar({ percent }: { percent: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Engagement</span>
        <span>{percent}%</span>
      </div>
      <Progress value={percent} />
    </div>
  );
}
