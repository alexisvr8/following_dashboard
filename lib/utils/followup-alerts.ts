import { followupTicketId, type ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { isOwnActionable } from "@/lib/utils/capacity";
import { mailTickets } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";

// Alertas de seguimiento: que ninguna cuenta asignada pase más de `staleBusinessDays` días
// hábiles sin actualización sobre lo último acordado.
// - client_waiting: el último mail es del cliente y no se respondió (≥1 día hábil).
// - awaiting_client: el último movimiento es un mail nuestro sin respuesta y hay pendientes.
// - no_progress: sin mails ni reuniones hace N días hábiles y hay accionables abiertos.

export type AlertKind = "client_waiting" | "awaiting_client" | "no_progress";

export interface AccountAlert {
  clientId: string;
  name: string;
  kind: AlertKind;
  businessDays: number;
  lastMovementAt: string;
  lastMovementLabel: string;
  pendingOwn: number;
  pendingClient: number;
}

/** Días hábiles completos transcurridos desde `iso` (sin contar ese día) hasta hoy inclusive. */
export function businessDaysSince(iso: string, now: Date, workDays: number[]): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let n = 0;
  while (d < today) {
    d.setDate(d.getDate() + 1);
    if (workDays.includes(d.getDay())) n++;
  }
  return n;
}

export function accountPending(client: ClientRecord, settings: WorkSettings, now = new Date()) {
  const latest = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
  const done = new Set(client.doneTicketIds ?? []);
  let pendingOwn = 0;
  let pendingClient = 0;
  for (const a of accountActionables(client)) {
    if (a.done) continue;
    const side = client.actionableSide?.[a.id];
    if (side ? side === "debo" : isOwnActionable(a.step, settings)) pendingOwn++;
    else pendingClient++;
  }
  if (latest && now.getTime() - Date.parse(latest.date) <= 14 * 86_400_000 && !done.has(followupTicketId(client.id, latest.id))) {
    pendingOwn++;
  }
  for (const t of mailTickets(client)) if (!done.has(t.id)) pendingOwn++;
  return { latest, done, pendingOwn, pendingClient };
}

export interface Movement {
  at: string;
  label: string;
  /** El último movimiento es un mail de nuestro lado (mío o del equipo). */
  mine: boolean;
}

/** Último movimiento real de la cuenta: mail, minuta o evento de Calendar ya realizado. */
export function lastMovement(client: ClientRecord, now = new Date()): Movement | null {
  const latest = client.meetings.reduce<ClientRecord["meetings"][number] | null>(
    (max, m) => (!max || Date.parse(m.date) > Date.parse(max.date) ? m : max),
    null,
  );
  const a = client.activity;
  const candidates: Movement[] = [];
  if (a?.lastMail) {
    const m = a.lastMail;
    const who = m.direction === "me" ? "Tu mail" : `Mail de ${m.fromName ?? m.from}`;
    candidates.push({ at: m.date, label: `${who}: “${m.subject}”`, mine: m.direction !== "client" });
  }
  if (latest) candidates.push({ at: latest.date, label: `Reunión: ${latest.title}`, mine: false });
  if (a?.lastCalendarMeeting) {
    candidates.push({ at: a.lastCalendarMeeting.date, label: `Reunión: ${a.lastCalendarMeeting.title}`, mine: false });
  }
  return (
    candidates
      .filter((x) => Date.parse(x.at) <= now.getTime())
      .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0] ?? null
  );
}

export function computeAlerts(clients: ClientRecord[], settings: WorkSettings, now = new Date()): AccountAlert[] {
  const alerts: AccountAlert[] = [];
  for (const c of clients) {
    if (c.status !== "assigned") continue;
    const { done, pendingOwn, pendingClient } = accountPending(c, settings, now);
    const last = lastMovement(c, now);
    if (!last) continue;
    const base = { clientId: c.id, name: c.name, lastMovementAt: last.at, lastMovementLabel: last.label, pendingOwn, pendingClient };

    const reply = mailTickets(c).find((t) => t.id.endsWith("-reply"));
    if (reply && !done.has(reply.id)) {
      const days = businessDaysSince(reply.date, now, settings.workDays);
      if (days >= 1) {
        alerts.push({ ...base, kind: "client_waiting", businessDays: days });
        continue;
      }
    }
    const days = businessDaysSince(last.at, now, settings.workDays);
    if (days >= settings.staleBusinessDays && pendingOwn + pendingClient > 0) {
      alerts.push({ ...base, kind: last.mine ? "awaiting_client" : "no_progress", businessDays: days });
    }
  }
  const ORDER: Record<AlertKind, number> = { client_waiting: 0, no_progress: 1, awaiting_client: 2 };
  return alerts.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || y.businessDays - x.businessDays);
}
