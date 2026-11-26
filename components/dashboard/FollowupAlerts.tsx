"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClockOff,
  AlertTriangle,
  ArrowRight,
  CalendarX,
  Check,
  CheckCheck,
  ChevronDown,
  Hourglass,
  ListChecks,
  MailQuestionMark,
  MailWarning,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FollowupPanel, type FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import { cn } from "@/lib/utils";
import type { AccountAlert, AlertAction, AlertKind, AlertReason, ReplyQueueItem } from "@/lib/utils/followup-alerts";
import { AttentionBadge } from "@/components/cuentas/AttentionToggle";
import type { MailKindChoice } from "@/components/cuentas/MailKindSwitch";

const KIND: Record<AlertKind, { label: string; icon: typeof AlertTriangle; tone: string }> = {
  client_waiting: { label: "Esperan tu respuesta", icon: MailWarning, tone: "text-critical" },
  client_request: { label: "Pedidos por mail", icon: MailQuestionMark, tone: "text-warning" },
  own_overdue: { label: "Accionables vencidos", icon: CalendarX, tone: "text-critical" },
  no_progress: { label: "Sin avances comunicados", icon: AlertTriangle, tone: "text-warning" },
  awaiting_client: { label: "Esperando al cliente", icon: Hourglass, tone: "text-muted-foreground" },
};

const ACTION: Record<AlertAction, { label: string; title: string; choice: MailKindChoice }> = {
  reply: { label: "Responder", title: "Respuesta sugerida con IA a sus consultas y pedidos sin contestar", choice: "reply" },
  status: { label: "Enviar status", title: "Contar lo que avanzaste y lo que sigue", choice: "general" },
  reminder: { label: "Pedir status", title: "Recordatorio de lo que tiene pendiente el cliente", choice: "reminder" },
};

// Fondo oscuro: los neutros usan `muted-foreground` / `divider` (no `subtle-foreground` / `border`, que se pierden en la card).
const REASON_TONE: Record<AlertReason["tone"], string> = {
  critical: "bg-critical",
  warning: "bg-warning",
  muted: "bg-muted-foreground",
};

/** Rango de días sin interacción: chip y filtro rápido. */
type Range = "all" | "low" | "mid" | "high";
const rangeOf = (d: number): Exclude<Range, "all"> => (d >= 6 ? "high" : d >= 4 ? "mid" : "low");
const RANGES: { id: Range; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "low", label: "≤3 d" },
  { id: "mid", label: "4–5 d" },
  { id: "high", label: "+6 d" },
];
const DAYS_CHIP: Record<Exclude<Range, "all">, { variant: "outline" | "warning" | "critical"; className?: string }> = {
  low: { variant: "outline", className: "border-border-strong bg-accent text-foreground-strong" },
  mid: { variant: "warning" },
  high: { variant: "critical" },
};

// Pulso de cuentas (Seguimiento del Dashboard): cuentas asignadas con algo abierto que esperan respuesta o llevan
// ≥N días hábiles sin interacción (mail con el cliente, del equipo sobre tus avances o reunión) y sin reunión cerca.
// La tarjeta muestra el porqué (sin mails); la acción abre el panel (hilo + borrador) sin salir del Dashboard.
export function FollowupAlerts({
  alerts,
  queue = [],
  unassignedCount = 0,
  panels,
  staleDays,
  lastSyncAt,
}: {
  alerts: AccountAlert[];
  /** Cuentas activas con pedidos por mail sin resolver (no entran como tarjeta). */
  queue?: ReplyQueueItem[];
  /** Mails externos dirigidos a ti que no son de ninguna cuenta (bandeja en /clientes). */
  unassignedCount?: number;
  panels: Record<string, FollowupPanelData>;
  staleDays: number;
  lastSyncAt: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openChoice, setOpenChoice] = useState<MailKindChoice>("general");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<Range>("all");
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<{ id: string; name: string } | null>(null);
  const openCard = alerts.find((a) => a.clientId === openId);
  const openQueued = openCard ? undefined : queue.find((q) => q.clientId === openId);
  const openAlert = openCard
    ? { clientId: openCard.clientId, name: openCard.name, lastMovementLabel: openCard.lastMovementLabel, businessDays: openCard.silentDays }
    : openQueued && { clientId: openQueued.clientId, name: openQueued.name };
  const counts = { low: 0, mid: 0, high: 0 };
  for (const a of alerts) counts[rangeOf(a.silentDays)]++;
  const shown = range === "all" ? alerts : alerts.filter((a) => rangeOf(a.silentDays) === range);

  // Errores de red (servidor reiniciándose, sin conexión) o de la API: aviso en la sección, nunca un rechazo suelto.
  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/sync-activity", { method: "POST" });
      if (!res.ok) setError("No se pudieron actualizar los mails. Reintenta en un momento.");
      router.refresh();
    } catch {
      setError("Sin conexión con el servidor (¿se está reiniciando?). Reintenta en un momento.");
    } finally {
      setSyncing(false);
    }
  }

  async function patch(clientId: string, body: unknown) {
    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
      else setError("No se pudo guardar el cambio. Reintenta.");
      return res.ok;
    } catch {
      setError("Sin conexión con el servidor. Reintenta en un momento.");
      return false;
    }
  }

  // Pedido respondido: se tilda como cualquier accionable (`doneTicketIds`); "Quitar" = no era un pedido
  // (`removedTicketIds`, no vuelve). La alerta se recalcula.
  async function markDone(clientId: string, ticketId: string, how: "done" | "remove" = "done") {
    setClosing((s) => new Set(s).add(ticketId));
    try {
      await patch(clientId, how === "remove" ? { actionable: { op: "remove", id: ticketId } } : { ticketId, isDone: true });
    } finally {
      setClosing((s) => {
        const n = new Set(s);
        n.delete(ticketId);
        return n;
      });
    }
  }

  /** "Ya respondí todo": pedidos abiertos + "Responder" de su último mail, como respondidos. */
  async function markAllAnswered(a: AccountAlert) {
    const ids = [...(a.requests ?? []).map((r) => r.id), ...(a.replyTicketId ? [a.replyTicketId] : [])];
    setClosing((s) => new Set([...s, ...ids]));
    try {
      for (const id of ids) {
        await fetch(`/api/clients/${encodeURIComponent(a.clientId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: id, isDone: true }),
        });
      }
      router.refresh();
    } catch {
      setError("Sin conexión con el servidor: algunos pedidos pueden no haberse marcado. Reintenta.");
      router.refresh();
    } finally {
      setClosing((s) => {
        const n = new Set(s);
        for (const id of ids) n.delete(id);
        return n;
      });
    }
  }

  /** ✕ en "Por responder": no hace falta contestar → los pedidos se quitan (`removedTicketIds`, no vuelven). */
  async function dismissQueued(q: ReplyQueueItem) {
    setDismissed((s) => new Set(s).add(q.clientId));
    const results = await Promise.all(
      q.ids.map((id) =>
        fetch(`/api/clients/${encodeURIComponent(q.clientId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionable: { op: "remove", id } }),
        })
          .then((r) => r.ok)
          .catch(() => false),
      ),
    );
    if (results.some((ok) => !ok)) {
      setDismissed((s) => {
        const n = new Set(s);
        n.delete(q.clientId);
        return n;
      });
      setError(`No se pudieron quitar todos los pedidos de ${q.name}. Reintenta.`);
    }
    router.refresh();
  }

  async function snooze(a: AccountAlert, mode: "tomorrow" | "interaction" | null) {
    setSnoozeFor(null);
    if (await patch(a.clientId, { profile: { followupSnooze: mode } })) setSnoozed(mode ? { id: a.clientId, name: a.name } : null);
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 xl:h-full">
      {/* 1. Encabezado */}
      <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-label-sm uppercase text-subtle-foreground">Pulso de cuentas</h2>
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

      {/* 2. Resumen + filtro por días sin interacción */}
      <div className="flex shrink-0 flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {alerts.length ? (
            <>
              <b className="tabular font-medium text-foreground-strong">{alerts.length}</b> cuenta{alerts.length === 1 ? "" : "s"} sin
              interacción (mail, reunión ni tildes) hace ≥{staleDays} días hábiles y sin reunión esta semana
            </>
          ) : (
            <>Todas las cuentas con pendientes tuvieron interacción en los últimos {staleDays} días hábiles o reunión esta semana.</>
          )}
        </p>
        {alerts.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por días sin interacción">
            {RANGES.map((r) => {
              const n = r.id === "all" ? alerts.length : counts[r.id];
              if (r.id !== "all" && !n) return null;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={cn(
                    "tabular rounded-md border px-2 py-0.5 text-label-sm transition-colors",
                    range === r.id
                      ? "border-muted-foreground bg-accent text-foreground-strong"
                      : "border-border-strong text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {r.label} · {n}
                </button>
              );
            })}
          </div>
        )}
        {queue.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-1.5">
            <span className="flex items-center gap-1 text-label-sm uppercase text-muted-foreground">
              <MailQuestionMark className="size-3.5 text-warning" /> Por responder
            </span>
            {queue
              .filter((q) => !dismissed.has(q.clientId))
              .map((q) => (
                <span
                  key={q.clientId}
                  className="inline-flex items-center rounded-md border border-warning/25 bg-warning-muted text-xs text-foreground transition-colors hover:border-warning/50"
                >
                  <button
                    type="button"
                    title={["Pedidos sin resolver:", ...q.titles.map((t) => `• ${t}`)].join("\n")}
                    onClick={() => {
                      setOpenChoice("reply");
                      setOpenId(q.clientId);
                    }}
                    className="py-0.5 pl-2 pr-1"
                  >
                    {q.name} <span className="tabular text-warning">({q.count})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissQueued(q)}
                    title="No hace falta responder: quita estos pedidos y la alerta"
                    aria-label={`No hace falta responder a ${q.name}`}
                    className="rounded-r-md py-1 pl-0.5 pr-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
          </div>
        )}
        {unassignedCount > 0 && (
          <Link
            href="/clientes?tab=mails"
            className="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <MailQuestionMark className="size-3.5 text-warning" />
            <span className="tabular font-medium text-foreground">{unassignedCount}</span> mail{unassignedCount === 1 ? "" : "s"} sin cuenta ·
            <span className="font-medium text-foreground-strong">Revisar</span>
            <ArrowRight className="size-3" />
          </Link>
        )}
        {error && (
          <p role="alert" className="flex items-center gap-2 rounded-md border border-critical/25 bg-critical-muted px-2 py-1 text-xs text-foreground">
            <AlertTriangle className="size-3.5 shrink-0 text-critical" /> {error}
            <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setError(null)} aria-label="Cerrar aviso">
              <X className="size-3.5" />
            </button>
          </p>
        )}
        {snoozed && (
          <p className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">
            <AlarmClockOff className="size-3.5" /> {snoozed.name} pospuesta.
            <button
              type="button"
              className="font-medium text-foreground-strong hover:underline"
              onClick={async () => (await patch(snoozed.id, { profile: { followupSnooze: null } })) && setSnoozed(null)}
            >
              Deshacer
            </button>
          </p>
        )}
      </div>

      {/* 3. Una tarjeta por cuenta: en xl una columna con scroll interno; debajo de xl, grilla 2–3 columnas */}
      {shown.length > 0 && (
        <ul className="grid min-h-0 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:flex-1 xl:auto-rows-min xl:grid-cols-1 xl:overflow-y-auto xl:pr-1 [scrollbar-width:thin]">
          {shown.map((a) => {
            const k = KIND[a.kind];
            const r = rangeOf(a.silentDays);
            const actions = a.actions.filter((x) => x !== "reminder" || panels[a.clientId]?.reminder);
            const open = expanded.has(a.clientId);
            return (
              <li
                key={a.clientId}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors duration-150 hover:border-border-strong hover:bg-accent/40 hover:shadow-highlight"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2">
                    <k.icon className={cn("size-4 shrink-0", k.tone)} aria-label={k.label} />
                    <Link
                      href={`/cuentas/${encodeURIComponent(a.clientId)}`}
                      className="truncate text-base font-semibold leading-tight text-foreground-strong hover:underline"
                      title={`${a.name} · ${k.label}`}
                    >
                      {a.name}
                    </Link>
                    {a.attention && <AttentionBadge size="sm" />}
                  </p>
                  <Badge variant={DAYS_CHIP[r].variant} className={cn("tabular shrink-0", DAYS_CHIP[r].className)} title="Días hábiles sin interacción">
                    {a.silentDays} d
                  </Badge>
                </div>

                {/* Últimos 10 días hábiles: relleno = hubo contacto (mail o reunión). */}
                <div className="flex items-center gap-2">
                  <span className="flex gap-0.5" aria-label="Interacción en los últimos 10 días hábiles">
                    {a.trail.map((on, i) => (
                      <span
                        key={i}
                        className={cn("h-2 w-2.5 rounded-[2px]", on ? "bg-success" : "bg-divider", i === a.trail.length - 1 && "ring-1 ring-muted-foreground")}
                      />
                    ))}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground" title={`Último contacto: ${a.lastMovementLabel}`}>
                    {a.lastMovementLabel}
                  </span>
                </div>

                <ul className="flex flex-col gap-1">
                  {a.reasons.map((x) => (
                    <li key={x.text} className="flex items-center gap-2 text-xs leading-snug text-foreground">
                      <span className={cn("size-2 shrink-0 rounded-full", REASON_TONE[x.tone])} />
                      <span className={cn("min-w-0 truncate", x.tone === "muted" && "text-muted-foreground")}>{x.text}</span>
                    </li>
                  ))}
                </ul>

                {a.requests && a.requests.length > 0 && (
                  <div className="rounded-md border border-border-strong bg-surface">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((s) => {
                          const n = new Set(s);
                          if (n.has(a.clientId)) n.delete(a.clientId);
                          else n.add(a.clientId);
                          return n;
                        })
                      }
                      className="flex w-full items-center justify-between gap-2 px-2 py-1 text-label-sm uppercase text-muted-foreground hover:text-foreground-strong"
                    >
                      Por responder ({a.requests.length})
                      <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                    </button>
                  {open && (
                  <ul className="flex flex-col gap-1 border-t border-border px-2 py-1.5">
                    {a.requests.map((q) => (
                      <li key={q.id} className="flex items-start gap-1.5 text-xs leading-snug">
                        <span className="min-w-0 flex-1 line-clamp-2 text-foreground">{q.title}</span>
                        <span className="tabular shrink-0 text-subtle-foreground">
                          {new Date(q.date).toLocaleDateString("es", { day: "2-digit", month: "2-digit" })}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-5 shrink-0 px-1"
                          title="Ya lo respondí"
                          aria-label="Marcar pedido respondido"
                          disabled={closing.has(q.id)}
                          onClick={() => markDone(a.clientId, q.id)}
                        >
                          <Check />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-5 shrink-0 px-1 text-muted-foreground hover:text-critical"
                          title="Quitar: no es algo para responder"
                          aria-label="Quitar pedido"
                          disabled={closing.has(q.id)}
                          onClick={() => markDone(a.clientId, q.id, "remove")}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                    <li className="flex justify-end pt-0.5">
                      <Button size="xs" variant="ghost" className="h-5 px-1.5 text-muted-foreground" onClick={() => markAllAnswered(a)}>
                        <CheckCheck /> Ya respondí todo
                      </Button>
                    </li>
                  </ul>
                  )}
                  </div>
                )}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-1.5 border-t border-border pt-1.5">
                  {snoozeFor === a.clientId ? (
                    <div className="flex flex-wrap items-center gap-1 text-sm">
                      <span className="text-subtle-foreground">Posponer:</span>
                      <Button size="sm" variant="outline" onClick={() => snooze(a, "tomorrow")}>
                        Hasta mañana
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => snooze(a, "interaction")}>
                        Hasta el próximo contacto
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSnoozeFor(null)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Accionables de esta cuenta"
                          nativeButton={false}
                          render={<Link href={`/accionables?cuentas=${encodeURIComponent(a.clientId)}`} />}
                        >
                          <ListChecks /> Accionables
                        </Button>
                        <Button size="sm" variant="ghost" title="Posponer" onClick={() => setSnoozeFor(a.clientId)}>
                          <AlarmClockOff /> Posponer
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {actions.map((x, i) => (
                          <Button
                            key={x}
                            size="sm"
                            variant={i === 0 ? "default" : "outline"}
                            title={ACTION[x].title}
                            onClick={() => {
                              setOpenChoice(ACTION[x].choice);
                              setOpenId(a.clientId);
                            }}
                          >
                            {ACTION[x].label} {i === 0 && <ArrowRight />}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {openAlert && (
        <FollowupPanel
          key={`${openAlert.clientId}-${openChoice}`}
          alert={openAlert}
          data={panels[openAlert.clientId]}
          open={!!openId}
          onOpenChange={(o) => !o && setOpenId(null)}
          initialChoice={
            openChoice === "reminder" && panels[openAlert.clientId]?.reminder
              ? "reminder"
              : openChoice === "reply" && panels[openAlert.clientId]?.reply
                ? "reply"
                : "general"
          }
        />
      )}
    </div>
  );
}
