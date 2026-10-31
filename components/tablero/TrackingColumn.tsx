"use client";

import { useState } from "react";
import { TrackingCard } from "@/components/tablero/TrackingCard";
import { cn } from "@/lib/utils";
import type { Account, TrackingStatus } from "@/types/account";

export function TrackingColumn({
  label,
  status,
  accounts,
  onDropAccount,
}: {
  label: string;
  status: TrackingStatus;
  accounts: Account[];
  onDropAccount: (accountId: string, status: TrackingStatus) => void;
}) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const accountId = e.dataTransfer.getData("text/plain");
        onDropAccount(accountId, status);
      }}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3 transition-colors",
        isOver && "bg-muted",
      )}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        <span className="text-xs text-muted-foreground">{accounts.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {accounts.map((account) => (
          <TrackingCard key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}
