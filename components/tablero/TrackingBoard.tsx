"use client";

import { useState } from "react";
import { TrackingColumn } from "@/components/tablero/TrackingColumn";
import { TRACKING_COLUMNS } from "@/lib/tracking";
import type { Account, TrackingStatus } from "@/types/account";

export function TrackingBoard({ accounts: initialAccounts }: { accounts: Account[] }) {
  // Estado local en Fase 1: sin persistencia. TODO Fase 2: persistir tracking_status en Supabase.
  const [accounts, setAccounts] = useState(initialAccounts);

  function handleDrop(accountId: string, status: TrackingStatus) {
    setAccounts((prev) =>
      prev.map((a) => (a.id === accountId ? { ...a, trackingStatus: status } : a)),
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {TRACKING_COLUMNS.map(({ status, label }) => (
        <TrackingColumn
          key={status}
          status={status}
          label={label}
          accounts={accounts.filter((a) => a.trackingStatus === status)}
          onDropAccount={handleDrop}
        />
      ))}
    </div>
  );
}
