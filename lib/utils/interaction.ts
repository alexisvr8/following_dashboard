import type { ClientRecord, MailRef } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { accountActionables } from "@/lib/utils/actionables";
import { isOwnActionable } from "@/lib/utils/capacity";

// Interacción real con la cuenta (base del "Pulso de cuentas" del Dashboard y del orden de accionables):
// - mail mío a participantes/referentes del cliente, o de ellos a mí;
// - mail de un compañero solo si trata accionables míos (`relatedTicketIds` ∩ lo que debo): si no, no comunica avances;
// - reunión ya realizada (minuta o evento de Calendar);
// - accionable tildado (mío o del cliente): avanzar también es mover la cuenta.

export type InteractionKind = "meeting" | "mail_me" | "mail_client" | "mail_team" | "tick";

export interface Interaction {
  at: string;
  kind: InteractionKind;
}

/** Ventana de la mini línea de tiempo de la tarjeta (días hábiles, hoy incluido). */
export const TRAIL_DAYS = 10;
/** Con reunión agendada dentro de estos días hábiles la cuenta no aparece en el Pulso (se va a hablar ahí). */
export const SOON_MEETING_DAYS = 2;

function ownTicketIds(client: ClientRecord, settings: WorkSettings): Set<string> {
  const ids = new Set<string>();
  for (const a of accountActionables(client)) {
    const side = client.actionableSide?.[a.id];
    if (side ? side === "debo" : isOwnActionable(a.step, settings)) ids.add(a.id);
  }
  return ids;
}

/** Todas las interacciones conocidas (pasadas), más nueva primero. */
export function interactions(client: ClientRecord, settings: WorkSettings, now = new Date()): Interaction[] {
  const own = ownTicketIds(client, settings);
  const mails = new Map<string, MailRef>();
  for (const m of [...(client.activity?.recentMails ?? []), ...(client.activity?.lastMail ? [client.activity.lastMail] : [])]) {
    mails.set(m.messageId, m);
  }
  const out: Interaction[] = [];
  for (const m of mails.values()) {
    if (m.direction === "me") out.push({ at: m.date, kind: "mail_me" });
    else if (m.direction === "client") out.push({ at: m.date, kind: "mail_client" });
    else if (m.relatedTicketIds?.some((id) => own.has(id))) out.push({ at: m.date, kind: "mail_team" });
  }
  for (const m of client.meetings) out.push({ at: m.date, kind: "meeting" });
  if (client.activity?.lastCalendarMeeting) out.push({ at: client.activity.lastCalendarMeeting.date, kind: "meeting" });
  // Tildes de accionables de esta cuenta (minuta, propios, IA). Los de mails ("Responder", pedidos) y el "Enviar minuta"
  // sintético no cuentan: la sync los tilda sola y lo que los resolvió ya es un mail (que sí cuenta).
  const done = new Set(client.doneTicketIds ?? []);
  for (const [id, at] of Object.entries(client.doneTicketAt ?? {})) {
    if (!done.has(id) || !id.startsWith(`${client.id}:`) || id.includes(":mail-") || id.endsWith("-followup")) continue;
    out.push({ at, kind: "tick" });
  }
  return out.filter((x) => Date.parse(x.at) <= now.getTime()).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Últimos `TRAIL_DAYS` días hábiles (más viejo primero): `true` = hubo interacción ese día. */
export function interactionTrail(list: Interaction[], now: Date, workDays: number[]): boolean[] {
  const days = new Set(list.map((x) => dayKey(new Date(x.at))));
  const out: boolean[] = [];
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  for (let guard = 0; out.length < TRAIL_DAYS && guard < 60; guard++) {
    if (workDays.includes(d.getDay())) out.unshift(days.has(dayKey(d)));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/** Días hábiles sin interacción para que la cuenta cuente como "en silencio" (Más atención: 1). */
export function silenceThreshold(client: ClientRecord, settings: WorkSettings): number {
  return client.profile?.attention ? Math.min(settings.staleBusinessDays, settings.attentionStaleDays ?? 1) : settings.staleBusinessDays;
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

/** Lunes 00:00 de la semana de `now` (sábado y domingo siguen siendo la semana que terminó). */
export function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Hubo reunión con la cuenta esta semana (lun → hoy): queda atendida hasta el lunes siguiente. */
export function metThisWeek(list: Interaction[], now: Date): boolean {
  const from = weekStart(now).getTime();
  return list.some((x) => x.kind === "meeting" && Date.parse(x.at) >= from);
}

/**
 * Cuenta en silencio: sin interacción (mail, reunión, tilde) hace ≥ `silenceThreshold` días hábiles, sin reunión esta
 * semana y sin reunión agendada dentro de `SOON_MEETING_DAYS` hábiles (`nextMeetingAt`). Entra al Pulso de cuentas y
 * sube sus accionables en el orden de trabajo (`focusTier`).
 */
export function isSilent(
  client: ClientRecord,
  settings: WorkSettings,
  now: Date,
  nextMeetingAt: string | null | undefined,
  list = interactions(client, settings, now),
): boolean {
  if (nextMeetingAt && businessDaysSince(now.toISOString(), new Date(nextMeetingAt), settings.workDays) <= SOON_MEETING_DAYS) return false;
  const last = list[0];
  if (!last || metThisWeek(list, now)) return false;
  return businessDaysSince(last.at, now, settings.workDays) >= silenceThreshold(client, settings);
}
