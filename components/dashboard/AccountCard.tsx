import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { EngagementBar } from "@/components/dashboard/EngagementBar";
import { CalendarVsExecutionGauge } from "@/components/dashboard/CalendarVsExecutionGauge";
import type { Account } from "@/types/account";

export function AccountCard({ account }: { account: Account }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{account.name}</CardTitle>
        <ChurnRiskBadge lastActivityAt={account.lastActivityAt} />
      </CardHeader>
      <CardContent className="space-y-4">
        <EngagementBar percent={account.engagementPercent ?? 0} />
        <CalendarVsExecutionGauge
          plannedMinutes={account.calendarMinutesPlanned}
          actualMinutes={account.executionMinutesActual}
        />
      </CardContent>
    </Card>
  );
}
