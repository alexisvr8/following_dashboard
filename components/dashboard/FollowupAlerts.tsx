"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Hourglass, MailWarning, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountAlert, AlertKind } from "@/lib/utils/followup-alerts";

const KIND: Record<AlertKind, { label: string; action: string; icon: typeof AlertTriangle; tone: string }> = {
  client_waiting: { label: "Cliente esperando respuesta", action: "Responder", icon: MailWarning, tone: "text-destructive" },
  no_progress: { label: "Sin avances comunicados", action: "Enviar actualización", icon: AlertTriangle, tone: "text-amber-600" },
  awaiting_client: { label: "Sin respuesta del cliente", action: "Hacer seguimiento", icon: Hourglass, tone: "text-muted-foreground" },
};

// Cuentas que llevan ≥N días hábiles sin actualización sobre lo último acordado.
export function FollowupAlerts({
  alerts,
  staleDays,
  lastSyncAt,
}: {
  alerts: AccountAlert[];
  staleDays: number;
  lastSyncAt: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/clients/sync-activity", { method: "POST" });
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {alerts.length ? (
              <>
                <b>{alerts.length}</b> cuenta{alerts.length === 1 ? "" : "s"} sin actualización hace ≥{staleDays} días
                hábiles o esperando respuesta
              </>
            ) : (
              <>Todas las cuentas asignadas tuvieron movimiento en los últimos {staleDays} días hábiles.</>
            )}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {lastSyncAt && <span>Mails al {new Date(lastSyncAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}</span>}
            <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={syncing ? "animate-spin" : undefined} /> {syncing ? "Actualizando…" : "Actualizar"}
            </Button>
          </div>
        </div>
        {alerts.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {alerts.map((a) => {
              const k = KIND[a.kind];
              return (
                <li key={a.clientId} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <k.icon className={`size-4 shrink-0 ${k.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {a.name} <span className={`font-normal ${k.tone}`}>· {k.label} · {a.businessDays} día{a.businessDays === 1 ? "" : "s"} háb.</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Último: {a.lastMovementLabel} · {a.pendingOwn} pendientes tuyos · {a.pendingClient} del cliente
                    </p>
                  </div>
                  <Link
                    href={`/cuentas/${encodeURIComponent(a.clientId)}?borrador=status#borradores`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {k.action} <ArrowRight className="size-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
