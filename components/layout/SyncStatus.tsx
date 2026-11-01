"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Status {
  lastRunAt: string | null;
  ok: boolean;
  error: string | null;
  newMeetings: number;
  synced: number;
  schedulerEnabled: boolean;
}

const POLL_MS = 60_000;

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

// Indicador de la última sincronización automática. Cuando detecta una corrida nueva hace
// `router.refresh()` para que Dashboard/Tablero/cuenta muestren los datos frescos sin recargar.
export function SyncStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastSeen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/cron/sync", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const next = (await res.json()) as Status;
        if (lastSeen.current !== undefined && next.lastRunAt !== lastSeen.current) router.refresh();
        lastSeen.current = next.lastRunAt;
        setStatus(next);
        setNow(Date.now());
      } catch {
        /* sin red: se reintenta en el próximo ciclo */
      }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);

  if (!status?.lastRunAt) return null;
  const failed = !status.ok;
  const title = failed
    ? `Última sincronización falló: ${status.error ?? "error"}`
    : `${status.synced} clientes sincronizados · ${status.newMeetings} reuniones nuevas` +
      (status.schedulerEnabled ? " · automática activa" : " · automática desactivada");

  return (
    <span
      title={title}
      className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:inline-flex"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          failed ? "bg-destructive" : status.schedulerEnabled ? "bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      <RefreshCw className="size-3" aria-hidden />
      {ago(status.lastRunAt, now)}
    </span>
  );
}
