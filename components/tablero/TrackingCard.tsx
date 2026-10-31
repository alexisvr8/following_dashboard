"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import type { Account } from "@/types/account";

export function TrackingCard({ account }: { account: Account }) {
  return (
    <Card
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", account.id)}
      className="cursor-grab gap-2 py-3 active:cursor-grabbing"
    >
      <CardHeader className="gap-1.5 px-3">
        <CardTitle className="text-sm">{account.name}</CardTitle>
        <ChurnRiskBadge lastActivityAt={account.lastActivityAt} />
      </CardHeader>
      <CardContent className="px-3 text-xs text-muted-foreground">
        {account.lastNoteSummary ?? "Sin notas de seguimiento todavía."}
      </CardContent>
    </Card>
  );
}
