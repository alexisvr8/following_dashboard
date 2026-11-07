"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Hourglass, MailWarning, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FollowupPanel, type FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import { cn } from "@/lib/utils";
import type { AccountAlert, AlertKind } from "@/lib/utils/followup-alerts";

const KIND: Record<
  AlertKind,
  {
    label: string;
    action: string;
    icon: typeof AlertTriangle;
    tone: string;
    chip: "critical" | "warning" | "outline";
    primary: boolean;
  }
> = {
  client_waiting: {
    label: "Cliente esperando respuesta",
    action: "Responder",
    icon: MailWarning,
    tone: "text-critical",
    chip: "critical",
    primary: true,
  },
  no_progress: {
    label: "Sin avances comunicados",
    action: "Enviar actualización",
    icon: AlertTriangle,
    tone: "text-warning",
    chip: "warning",
    primary: false,
  },
  awaiting_client: {
    label: "Sin respuesta del cliente",
    action: "Hacer seguimiento",
    icon: Hourglass,
    tone: "text-muted-foreground",
    chip: "outline",
    primary: false,
  },
};

/** Primero las que esperan respuesta; dentro de cada grupo, más días hábiles primero. */
function byUrgency(a: AccountAlert, b: AccountAlert) {
  const w = (x: AccountAlert) => (x.kind === "client_waiting" ? 0 : 1);
  return w(a) - w(b) || b.businessDays - a.businessDays || a.name.localeCompare(b.name, "es");
}

// Columna de Seguimiento del Dashboard: cuentas que llevan ≥N días hábiles sin actualización o
// esperando respuesta. Cada acción abre el panel lateral (hilo + borrador) sin salir del Dashboard.
export function FollowupAlerts({
  alerts,
  panels,
  staleDays,
  lastSyncAt,
}: {
  alerts: AccountAlert[];
  panels: Record<string, FollowupPanelData>;
  staleDays: number;
  lastSyncAt: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const openAlert = alerts.find((a) => a.clientId === openId);
  const sorted = [...alerts].sort(byUrgency);

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
    <div className="flex min-h-0 flex-col gap-3 xl:h-full">
      {/* 1. Encabezado */}
      <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-label-sm uppercase text-subtle-foreground">Seguimiento</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastSyncAt && (
            <span className="tabular">
              Mails al {new Date(lastSyncAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
            <RefreshCw className={syncing ? "animate-spin" : undefined} /> {syncing ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
      </div>

      {/* 2. Título resumen */}
      <p className="shrink-0 text-sm text-muted-foreground">
        {alerts.length ? (
          <>
            <b className="tabular font-medium text-foreground-strong">{alerts.length}</b> cuenta{alerts.length === 1 ? "" : "s"} sin
            actualización hace ≥{staleDays} días hábiles o esperando respuesta
          </>
        ) : (
          <>Todas las cuentas asignadas tuvieron movimiento en los últimos {staleDays} días hábiles.</>
        )}
      </p>

      {/* 3. Una tarjeta por cuenta: en xl una columna con scroll interno; debajo de xl, grilla 2–3 columnas */}
      {sorted.length > 0 && (
        <ul className="grid min-h-0 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:flex-1 xl:auto-rows-min xl:grid-cols-1 xl:overflow-y-auto xl:pr-1 [scrollbar-width:thin]">
          {sorted.map((a) => {
            const k = KIND[a.kind];
            return (
              <li
                key={a.clientId}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors duration-150 hover:border-border-strong hover:bg-accent/40 hover:shadow-highlight"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2">
                    <k.icon className={cn("size-3.5 shrink-0", k.tone)} />
                    <span className="truncate text-sm font-medium text-foreground-strong" title={a.name}>
                      {a.name}
                    </span>
                  </p>
                  <span className={cn("shrink-0 text-label-sm", k.tone)}>
                    {a.businessDays} día{a.businessDays === 1 ? "" : "s"} háb.
                  </span>
                </div>
                <Badge variant={k.chip}>{k.label}</Badge>
                <p className="line-clamp-2 text-xs leading-snug text-muted-foreground" title={a.lastMovementLabel}>
                  Último: {a.lastMovementLabel}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-1.5">
                  <span className="text-label-sm text-subtle-foreground">
                    {a.pendingOwn} tuyos · {a.pendingClient} del cliente
                  </span>
                  <Button size="xs" variant={k.primary ? "default" : "outline"} onClick={() => setOpenId(a.clientId)}>
                    {k.action} <ArrowRight />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {openAlert && (
        <FollowupPanel
          key={openAlert.clientId}
          alert={openAlert}
          data={panels[openAlert.clientId]}
          open={!!openId}
          onOpenChange={(o) => !o && setOpenId(null)}
        />
      )}
    </div>
  );
}
