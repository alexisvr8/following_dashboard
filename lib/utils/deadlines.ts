import { followupTicketId, type ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import type { CalendarEventLite } from "@/lib/integrations/calendar";
import { accountActionables } from "@/lib/utils/actionables";
import { isOwnActionable, learnedRole } from "@/lib/utils/capacity";
import { mailTickets } from "@/lib/utils/mail-tickets";
import { isAutoTicket } from "@/lib/utils/auto-ticket";
import { keywordSimilarity } from "@/lib/utils/mail-classify";
import { addBusinessDays, parseStep, rollToWorkday, type StepDue } from "@/lib/utils/gemini-notes-parser";

// Plazo de cada accionable pendiente (meta: cerrar todo dentro de la semana hábil con el cliente).
// Fecha, por orden: manual (`client.actionableDue`) → acordada (dicha en la reunión o el mail, resuelta
// contra ESE día por `parseDue`) → meta interna (`targetBusinessDays` hábiles desde el origen; vence a los
// `limitBusinessDays`). La meta interna es solo para planificar: los mails al cliente nunca la muestran.
// "Responder" y "Enviar follow-up" tienen plazo de 1 día hábil (no se espera la semana para contestar).

export type DueKind = "manual" | "agreed" | "target";
export type OweSide = "debo" | "me_deben";
export type Bucket = "overdue" | "today" | "this_week" | "next_week" | "later";
export type Priority = "alta" | "media" | "baja";
export type ItemKind = "step" | "custom" | "followup" | "reply" | "request" | "commitment";

export interface PlannedItem {
  id: string;
  clientId: string;
  clientName: string;
  erp: string | null;
  /** Título corto ("Compartir archivo de prueba", "Responder a Marcos"). */
  title: string;
  /** Detalle (lo que sigue al ":" en la minuta, la frase del mail, el asunto). */
  detail: string | null;
  /** Texto completo tal cual (minuta / mail / editado a mano). */
  fullText: string;
  owners: string[];
  side: OweSide;
  kind: ItemKind;
  originKind: "meeting" | "mail";
  /** Se puede quitar ("no corresponde"): los automáticos (Responder, follow-up) no. */
  removable: boolean;
  /** Reunión o mail de donde salió. */
  originTitle: string;
  originDate: string;
  carried: boolean;
  /** Fin del día de entrega (ISO). */
  due: string;
  dueLabel: string;
  dueKind: DueKind;
  /** Desde cuándo está vencido (ISO, fin de día): = `due`, salvo en la meta interna. */
  limit: string;
  estimateMinutes: number;
  estimateManual: boolean;
  /** De dónde sale la estimación: manual, aprendida de un accionable parecido o el default. */
  estimateSource: "manual" | "learned" | "default";
  /** Accionable parecido del que se aprendió la estimación. */
  estimateFrom?: string;
  sideManual: boolean;
  /** Qué se puede editar: título/detalle/responsables (minuta o propio), el texto (mail) o nada (automáticos). */
  editable: "step" | "mail" | null;
  bucket: Bucket;
  priority: Priority;
  /** Días hábiles hasta la entrega (0 = hoy, negativo = atrasado). */
  businessDaysLeft: number;
  nextMeetingAt: string | null;
  /** No entra en los huecos libres antes de su fecha (lo completa `computeWeekPlan`). */
  atRisk?: boolean;
}

const DAY_FMT = new Intl.DateTimeFormat("es", { weekday: "short", day: "2-digit", month: "2-digit" });
const label = (d: Date) => DAY_FMT.format(d).replace(".", "").replace(",", "");
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;

/** Reunión de Calendar ↔ cuenta: por email de contacto o dominio (no freemail). */
export function accountMatcher(clients: ClientRecord[]) {
  const matchers = clients.map((c) => ({
    id: c.id,
    name: c.name,
    emails: new Set(c.contactEmails.map((e) => e.toLowerCase())),
    domain: FREEMAIL.test(c.domain) ? null : c.domain,
  }));
  return (e: CalendarEventLite) =>
    matchers.find((m) => e.attendees.some((a) => m.emails.has(a) || (m.domain && a.endsWith(`@${m.domain}`))));
}

/** Próxima reunión futura de cada cuenta. */
export function nextMeetings(clients: ClientRecord[], events: CalendarEventLite[] | null, now = new Date()) {
  const out = new Map<string, string>();
  const match = accountMatcher(clients);
  for (const e of events ?? []) {
    if (Date.parse(e.start) <= now.getTime()) continue;
    const acc = match(e);
    if (acc && (!out.has(acc.id) || e.start < out.get(acc.id)!)) out.set(acc.id, e.start);
  }
  return out;
}

/** Días hábiles de hoy a `to` (0 = hoy; negativo = ya pasó). */
export function businessDaysBetween(now: Date, to: Date, workDays: number[]): number {
  const a = endOfDay(now);
  const b = endOfDay(to);
  const sign = b >= a ? 1 : -1;
  const d = new Date(a);
  let n = 0;
  while (sign > 0 ? d < b : d > b) {
    d.setDate(d.getDate() + sign);
    if (workDays.includes(d.getDay())) n += sign;
  }
  return n;
}

function bucketOf(due: Date, limit: Date, dueKind: DueKind, now: Date): Bucket {
  const today = endOfDay(now);
  if ((dueKind === "target" ? limit : due) < today) return "overdue";
  // Meta interna ya pasada pero dentro del límite: es para hoy.
  if (due <= today) return "today";
  const sunday = endOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7)));
  if (due <= sunday) return "this_week";
  const nextSunday = new Date(sunday);
  nextSunday.setDate(nextSunday.getDate() + 7);
  return due <= nextSunday ? "next_week" : "later";
}

function priorityOf(item: Pick<PlannedItem, "bucket" | "kind" | "businessDaysLeft" | "side" | "nextMeetingAt">, now: Date, workDays: number[]): Priority {
  if (item.bucket === "overdue" || item.businessDaysLeft <= 0 || item.kind === "reply") return "alta";
  const meetingSoon =
    item.nextMeetingAt != null && businessDaysBetween(now, new Date(item.nextMeetingAt), workDays) <= 1;
  if (item.businessDaysLeft <= 1) return meetingSoon || item.side === "debo" ? "alta" : "media";
  if (item.businessDaysLeft <= 2 || meetingSoon) return "media";
  return "baja";
}

const PRIORITY_RANK: Record<Priority, number> = { alta: 0, media: 1, baja: 2 };

/** Orden de trabajo: primero lo que vence antes; a igual fecha, prioridad y luego lo mío. */
export function compareItems(a: PlannedItem, b: PlannedItem): number {
  return (
    a.due.localeCompare(b.due) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.side === b.side ? 0 : a.side === "debo" ? -1 : 1) ||
    a.originDate.localeCompare(b.originDate)
  );
}

/** Fecha que se puede mostrar al cliente: manual o acordada (nunca la meta interna). */
export function agreedDue(client: ClientRecord, ticketId: string, text: string, originDate: string, workDays?: number[]): StepDue | null {
  const manual = client.actionableDue?.[ticketId];
  if (manual) {
    const d = rollToWorkday(new Date(`${manual}T23:59:59`), workDays);
    return { label: label(d), until: d };
  }
  return parseStep(text, originDate, workDays).due;
}

/** "Título: detalle" de Gemini → título corto + detalle (solo si el título queda razonable). */
export function splitTitle(text: string): { title: string; detail: string | null } {
  const t = text.trim();
  const i = t.indexOf(":");
  if (i >= 3 && i <= 70) {
    const detail = t.slice(i + 1).trim();
    if (detail.length >= 3) return { title: t.slice(0, i).trim(), detail };
  }
  return { title: t, detail: null };
}

/** Frase de cortesía sin pedido ("Buenas tardes, cómo están?"): no es un accionable. */
export function isGreetingOnly(text: string): boolean {
  const rest = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(hola+|buen[oa]+s?|dias?|tardes?|noches?|como|estan|estas|todo bien|que tal|espero|se encuentren|bien|saludos?|gracias|muchas)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return rest.length < 6;
}

const AUTHOR = /mail de (.+?) \(/;

interface RawItem {
  id: string;
  title: string;
  detail: string | null;
  fullText: string;
  owners: string[];
  side: OweSide;
  kind: ItemKind;
  originTitle: string;
  originDate: string;
  carried: boolean;
  /** Texto donde buscar la fecha dicha (sin el "[Dueño]"). */
  dueText: string | null;
  quick: boolean;
}

function rawItems(client: ClientRecord, settings: WorkSettings, now: Date): RawItem[] {
  const out: RawItem[] = [];
  const done = new Set(client.doneTicketIds ?? []);
  for (const a of accountActionables(client)) {
    if (a.done) continue;
    const parsed = parseStep(a.step, a.meeting.date, settings.workDays);
    out.push({
      id: a.id,
      ...splitTitle(parsed.text),
      fullText: parsed.text,
      owners: parsed.owners,
      side: isOwnActionable(a.step, settings) ? "debo" : "me_deben",
      kind: a.id.includes(":custom-") ? "custom" : "step",
      originTitle: a.meeting.title,
      originDate: a.meeting.date,
      carried: a.carried,
      dueText: a.step,
      quick: false,
    });
  }
  const latest = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest && now.getTime() - Date.parse(latest.date) <= 14 * 86_400_000) {
    const id = followupTicketId(client.id, latest.id);
    if (!done.has(id)) {
      out.push({
        id,
        title: "Enviar minuta de la reunión",
        detail: latest.title,
        fullText: `Enviar minuta / follow-up de “${latest.title}”`,
        owners: [],
        side: "debo",
        kind: "followup",
        originTitle: latest.title,
        originDate: latest.date,
        carried: false,
        dueText: null,
        quick: true,
      });
    }
  }
  for (const t of mailTickets(client)) {
    if (done.has(t.id)) continue;
    if (t.kind !== "reply" && isGreetingOnly(t.title)) continue;
    const author = t.description.match(AUTHOR)?.[1];
    const head =
      t.kind === "reply"
        ? { title: t.title.split(/:\s*“/)[0], detail: t.subject }
        : t.kind === "request"
          ? { title: author ? `Pedido de ${author.split(/\s+/)[0]}` : "Pedido por mail", detail: t.title }
          : { title: "Compromiso tuyo por mail", detail: t.title };
    out.push({
      id: t.id,
      ...head,
      fullText: t.title,
      owners: [],
      side: "debo",
      kind: t.kind,
      originTitle: `Mail: ${t.subject}`,
      originDate: t.date,
      carried: false,
      dueText: t.kind === "reply" ? null : t.title,
      quick: t.kind === "reply",
    });
  }
  return out;
}

/** Pendientes con plazo de las cuentas asignadas, ordenados por fecha de entrega. */
export function plannedItems(
  clients: ClientRecord[],
  settings: WorkSettings,
  now = new Date(),
  meetingsByClient: Map<string, string> = new Map(),
): PlannedItem[] {
  const { workDays } = settings;
  const target = settings.targetBusinessDays ?? 3;
  const limitDays = Math.max(target, settings.limitBusinessDays ?? 4);
  const defaultMinutes = Math.max(5, Math.round(settings.hoursPerActionable * 60));
  const items: PlannedItem[] = [];
  const raws = clients.filter((c) => c.status === "assigned").flatMap((c) => rawItems(c, settings, now).map((r) => ({ c, r })));
  // Estimaciones aprendidas: lo que pusiste a mano en accionables parecidos (de cualquier cuenta).
  const learned = raws.flatMap(({ c, r }) => {
    const minutes = c.actionableEstimate?.[r.id];
    return minutes ? [{ id: r.id, text: `${r.title} ${r.detail ?? ""}`, title: r.title, minutes }] : [];
  });
  const learnEstimate = (r: RawItem) => {
    let best: (typeof learned)[number] | null = null;
    let score = 0;
    for (const l of learned) {
      if (l.id === r.id) continue;
      const s = keywordSimilarity(l.text, `${r.title} ${r.detail ?? ""}`);
      if (s >= 0.5 && s > score) {
        best = l;
        score = s;
      }
    }
    return best;
  };

  for (const { c, r } of raws) {
    const origin = new Date(r.originDate);
    const manual = c.actionableDue?.[r.id];
    const agreed = !manual && r.dueText ? parseStep(r.dueText, r.originDate, workDays).due : null;
    let due: Date;
    let limit: Date;
    let dueKind: DueKind;
    if (manual) {
      due = limit = rollToWorkday(new Date(`${manual}T23:59:59`), workDays);
      dueKind = "manual";
    } else if (agreed) {
      due = limit = agreed.until;
      dueKind = "agreed";
    } else {
      due = addBusinessDays(origin, r.quick ? 1 : target, workDays);
      limit = addBusinessDays(origin, r.quick ? 1 : limitDays, workDays);
      dueKind = "target";
    }
    const estimate = c.actionableEstimate?.[r.id];
    const fromLearned = estimate == null ? learnEstimate(r) : null;
    const sideOverride = c.actionableSide?.[r.id];
    const base = {
      bucket: bucketOf(due, limit, dueKind, now),
      kind: r.kind,
      side: sideOverride ?? r.side,
      businessDaysLeft: businessDaysBetween(now, dueKind === "target" && due < endOfDay(now) ? limit : due, workDays),
      nextMeetingAt: meetingsByClient.get(c.id) ?? null,
    };
    items.push({
      id: r.id,
      clientId: c.id,
      clientName: c.name,
      erp: c.profile?.erp || null,
      title: r.title,
      detail: r.detail,
      fullText: r.fullText,
      originKind: r.kind === "reply" || r.kind === "request" || r.kind === "commitment" ? "mail" : "meeting",
      removable: !isAutoTicket(r.id),
      editable: r.kind === "step" || r.kind === "custom" ? "step" : r.kind === "request" || r.kind === "commitment" ? "mail" : null,
      owners: r.owners,
      originTitle: r.originTitle,
      originDate: r.originDate,
      carried: r.carried,
      due: due.toISOString(),
      dueLabel: label(due),
      dueKind,
      limit: limit.toISOString(),
      estimateMinutes: estimate ?? fromLearned?.minutes ?? defaultMinutes,
      estimateManual: estimate != null,
      estimateSource: estimate != null ? "manual" : fromLearned ? "learned" : "default",
      ...(fromLearned && { estimateFrom: fromLearned.title }),
      sideManual: sideOverride != null,
      priority: priorityOf(base, now, workDays),
      ...base,
    });
  }
  return items.sort(compareItems);
}

export interface SuggestedItem {
  id: string;
  clientId: string;
  clientName: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  speaker: string;
  /** A nombre de quién quedaría el accionable al aceptarlo. */
  owner: string | null;
  ts: string;
  text: string;
  side: OweSide;
  kind: "commit" | "ask";
  atClose: boolean;
  /** Fecha dicha en ese momento de la charla (AAAA-MM-DD), si la hay. */
  due: string | null;
  dueLabel: string | null;
}

const SUGGESTION_DAYS = 21;
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Compromisos / pedidos de la transcripción todavía sin resolver (reuniones de los últimos 21 días de cuentas
 * asignadas). Se ocultan los parecidos a algo ya descartado en la cuenta o a un accionable vigente.
 */
export function pendingSuggestions(
  clients: ClientRecord[],
  settings: WorkSettings,
  now = new Date(),
  ownerEmail: string | null = null,
): SuggestedItem[] {
  const since = now.getTime() - SUGGESTION_DAYS * 86_400_000;
  const ownDomain = ownerEmail?.split("@")[1]?.toLowerCase() ?? null;
  const out: SuggestedItem[] = [];
  const isMe = (name: string) => {
    const role = learnedRole(name, settings);
    return role ? role === "me" : isOwnActionable(`[${name}]`, settings) && !!name;
  };
  const nameKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  /** De nuestro lado: yo, alguien marcado como equipo, o un asistente con el dominio propio. */
  const isOurs = (name: string, m: ClientRecord["meetings"][number]) => {
    if (isMe(name)) return true;
    const role = learnedRole(name, settings);
    if (role) return role === "team";
    const a = m.attendees?.find((x) => x.name && nameKey(x.name) === nameKey(name));
    return !!(a && ownDomain && a.email.toLowerCase().endsWith(`@${ownDomain}`));
  };
  for (const c of clients) {
    if (c.status !== "assigned") continue;
    const resolved = c.suggestions ?? {};
    const dismissed = Object.values(resolved).filter((r) => r.state === "dismissed").map((r) => r.text);
    const current = accountActionables(c).map((a) => a.step);
    for (const m of c.meetings) {
      if (!m.transcript?.length || Date.parse(m.date) < since) continue;
      for (const t of m.transcript) {
        if (resolved[t.id]) continue;
        if (dismissed.some((d) => keywordSimilarity(d, t.text) >= 0.7)) continue;
        if (current.some((s) => keywordSimilarity(s, t.text) >= 0.5)) continue;
        // Compromiso: mío → debo; de otro (cliente o equipo) → me deben. Pedido: si lo pide nuestro lado → me deben.
        const side: OweSide =
          t.kind === "commit" ? (isMe(t.speaker) ? "debo" : "me_deben") : isOurs(t.speaker, m) ? "me_deben" : "debo";
        const owner = t.kind === "commit" ? t.speaker : t.addressee;
        const due = parseStep(t.context, m.date, settings.workDays).due;
        out.push({
          id: t.id,
          clientId: c.id,
          clientName: c.name,
          meetingId: m.id,
          meetingTitle: m.title,
          meetingDate: m.date,
          speaker: t.speaker,
          owner,
          ts: t.ts,
          text: t.text,
          side,
          kind: t.kind,
          atClose: t.atClose,
          due: due ? isoDate(due.until) : null,
          dueLabel: due ? label(due.until) : null,
        });
      }
    }
  }
  return out.sort((a, b) => b.meetingDate.localeCompare(a.meetingDate) || Number(b.atClose) - Number(a.atClose) || a.ts.localeCompare(b.ts));
}
