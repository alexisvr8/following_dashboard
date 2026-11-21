import { followupTicketId, type ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { isOwnActionable } from "@/lib/utils/capacity";
import { actionableMailTickets, mailTickets, openMailRequests } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";
import { plannedItems } from "@/lib/utils/deadlines";
import { businessDaysSince, interactionTrail, interactions, isSilent, type Interaction } from "@/lib/utils/interaction";

export { businessDaysSince } from "@/lib/utils/interaction";

// "Pulso de cuentas" (sección Seguimiento del Dashboard): SOLO cuentas asignadas en silencio (`isSilent`) con algo
// abierto de cualquier lado: nada (mail mío/del cliente, del equipo sobre mis avances, reunión, tilde) hace
// ≥ `staleBusinessDays` (Más atención: `attentionStaleDays`), sin reunión esta semana ni agendada dentro de
// `SOON_MEETING_DAYS` hábiles. El motivo principal (`kind`): client_waiting (su último mail pide/pregunta algo y sigue
// sin respuesta), client_request (pedidos por mail abiertos), awaiting_client (lo último fue nuestro y tienen
// pendientes) o no_progress (falta comunicar avances). `own_overdue` ya no se usa (queda por datos guardados).
// Cuentas activas con pedidos abiertos → franja aparte `replyQueue`.
// Posponer (`profile.followupSnooze`): hasta una fecha, o hasta la próxima interacción.

export type AlertKind = "client_waiting" | "client_request" | "own_overdue" | "awaiting_client" | "no_progress";
/** Mail que propone la tarjeta: responder, enviar avances o pedir status de lo que tiene el cliente. */
export type AlertAction = "reply" | "status" | "reminder";

export interface AlertRequest {
  id: string;
  title: string;
  date: string;
  subject: string;
}

export interface AlertReason {
  tone: "critical" | "warning" | "muted";
  text: string;
}

export interface AccountAlert {
  clientId: string;
  name: string;
  /** Cuenta "Más atención": entra al Pulso desde `attentionStaleDays` (1) día hábil. */
  attention?: boolean;
  kind: AlertKind;
  /** Mails que ofrece la tarjeta, el principal primero (responder / enviar status, y pedir status si el cliente tiene puntos). */
  actions: AlertAction[];
  /** Días hábiles del motivo principal (mail sin responder o silencio). */
  businessDays: number;
  /** Días hábiles sin interacción. */
  silentDays: number;
  lastMovementAt: string;
  /** Último contacto, sin asuntos ni contenido de mails ("Reunión del vie 14/11"). */
  lastMovementLabel: string;
  /** Últimos `TRAIL_DAYS` días hábiles (más viejo primero): hubo interacción ese día. */
  trail: boolean[];
  /** Próxima reunión agendada (más allá de `SOON_MEETING_DAYS`), si se conoce. */
  nextMeetingAt?: string;
  pendingOwn: number;
  pendingClient: number;
  overdueOwn: number;
  /** Por qué está en la lista, sin mostrar mails. */
  reasons: AlertReason[];
  /** Pedidos del cliente por mail sin resolver (más viejo primero); se tildan o quitan desde la tarjeta. */
  requests?: AlertRequest[];
  /** Ticket "Responder" abierto (para "Ya respondí todo"). */
  replyTicketId?: string;
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
  for (const t of actionableMailTickets(client)) if (!done.has(t.id)) pendingOwn++;
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

const DAY = new Intl.DateTimeFormat("es", { weekday: "short", day: "2-digit", month: "2-digit" });
const day = (iso: string) => DAY.format(new Date(iso)).replace(".", "").replace(",", "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CONTACT: Record<Interaction["kind"], string> = {
  meeting: "Reunión",
  mail_me: "Tu mail",
  mail_client: "Mail del cliente",
  mail_team: "Mail del equipo sobre tus avances",
  tick: "Accionable tildado",
};

/** Pospuesta: hasta una fecha, o (sin `until`) hasta que haya una interacción posterior a cuando se pospuso. */
function snoozed(client: ClientRecord, last: Interaction | undefined, now: Date): boolean {
  const s = client.profile?.followupSnooze;
  if (!s) return false;
  if (s.until) return Date.parse(s.until) > now.getTime();
  return !last || Date.parse(last.at) <= Date.parse(s.at);
}

export function computeAlerts(
  clients: ClientRecord[],
  settings: WorkSettings,
  now = new Date(),
  /** Próxima reunión por cuenta (Calendar); sin esto no se excluyen las cuentas con reunión cerca. */
  meetings: Map<string, string> = new Map(),
): AccountAlert[] {
  const assigned = clients.filter((c) => c.status === "assigned");
  const overdue = new Map<string, number>();
  for (const i of plannedItems(assigned, settings, now, meetings)) {
    if (i.side === "debo" && i.bucket === "overdue") overdue.set(i.clientId, (overdue.get(i.clientId) ?? 0) + 1);
  }
  const { workDays } = settings;
  const alerts: AccountAlert[] = [];
  for (const c of assigned) {
    const { done, pendingOwn, pendingClient } = accountPending(c, settings, now);
    const list = interactions(c, settings, now);
    const last = list[0];
    if (!last || snoozed(c, last, now)) continue;
    const silentDays = businessDaysSince(last.at, now, workDays);
    const nextMeetingAt = meetings.get(c.id);

    const open = openMailRequests(c).sort((x, y) => x.date.localeCompare(y.date));
    const requests = open.map((t) => ({ id: t.id, title: t.title, date: t.date, subject: t.subject }));
    // "Responder" solo si el último mail del cliente pide o pregunta algo (un envío de adjuntos o un "gracias" no).
    const inbound = c.activity?.lastInboundMail;
    const reply = mailTickets(c).find((t) => t.id.endsWith("-reply"));
    // Quedan pedidos/preguntas abiertos de ese mail: al marcarlos respondidos o quitarlos, deja de esperar.
    const asks = !!inbound && open.some((t) => t.messageId === inbound.messageId);
    const waitingDays = reply && asks && !done.has(reply.id) ? businessDaysSince(reply.date, now, workDays) : 0;
    const requestDays = requests.length ? businessDaysSince(requests[0].date, now, workDays) : 0;
    // Solo entra en silencio: nada (mail, reunión, tilde) hace ≥N días hábiles, sin reunión esta semana ni cerca. Los
    // pedidos y vencidos de cuentas activas no la traen: van a la franja "Por responder" (`replyQueue`) o al tablero.
    if (!isSilent(c, settings, now, nextMeetingAt, list)) continue;
    const overdueOwn = overdue.get(c.id) ?? 0;
    if (pendingOwn + pendingClient + requests.length === 0) continue;

    // Avances sin comunicar: tildado después del último mail o reunión.
    const lastTalk = list.find((x) => x.kind !== "tick");
    const doneSince = accountActionables(c).filter(
      (a) => a.done && a.doneAt && (!lastTalk || Date.parse(a.doneAt) > Date.parse(lastTalk.at)),
    ).length;
    const ourSideLast = lastTalk?.kind === "mail_me" || lastTalk?.kind === "mail_team";
    const kind: AlertKind =
      waitingDays >= 1
        ? "client_waiting"
        : requestDays >= 1
          ? "client_request"
          : ourSideLast && pendingClient > 0 && doneSince === 0
            ? "awaiting_client"
            : "no_progress";
    // Todo lo que se puede mandar desde la tarjeta: responder (incluye avances) o avances, y pedir status de lo suyo.
    const actions: AlertAction[] = [];
    if (waitingDays >= 1 || requestDays >= 1) actions.push("reply");
    else if (pendingOwn > 0 || doneSince > 0) actions.push("status");
    if (pendingClient > 0) actions.push("reminder");
    if (!actions.length) actions.push("status");

    const reasons: AlertReason[] = [];
    if (waitingDays >= 1) reasons.push({ tone: "critical", text: `Mail del cliente con consultas sin responder · ${plural(waitingDays, "día háb.", "días háb.")}` });
    if (requests.length) reasons.push({ tone: "warning", text: `${plural(requests.length, "pedido")} por mail sin resolver` });
    if (overdueOwn) reasons.push({ tone: "critical", text: `${plural(overdueOwn, "accionable tuyo vencido", "accionables tuyos vencidos")}` });
    if (doneSince) reasons.push({ tone: "warning", text: `${plural(doneSince, "avance")} sin comunicar (tildado desde el último mail o reunión)` });
    const openOwn = pendingOwn - overdueOwn;
    if (openOwn > 0) reasons.push({ tone: "muted", text: `${plural(openOwn, "accionable tuyo abierto", "accionables tuyos abiertos")}` });
    if (pendingClient) {
      reasons.push({
        tone: "muted",
        text: `${plural(pendingClient, "punto")} del lado del cliente${ourSideLast ? " · tu último mail sigue sin respuesta" : ""}`,
      });
    }
    reasons.push({ tone: silentDays >= 6 ? "critical" : "warning", text: `Sin interacción hace ${plural(silentDays, "día háb.", "días háb.")} · sin reunión esta semana` });
    reasons.push(
      nextMeetingAt ? { tone: "muted", text: `Próxima reunión: ${day(nextMeetingAt)}` } : { tone: "muted", text: "Sin reunión agendada" },
    );

    alerts.push({
      clientId: c.id,
      name: c.name,
      ...(c.profile?.attention && { attention: true }),
      kind,
      actions,
      businessDays: kind === "client_waiting" ? waitingDays : kind === "client_request" ? requestDays : silentDays,
      silentDays,
      lastMovementAt: last.at,
      lastMovementLabel: `${CONTACT[last.kind]} del ${day(last.at)}`,
      trail: interactionTrail(list, now, workDays),
      ...(nextMeetingAt && { nextMeetingAt }),
      pendingOwn,
      pendingClient,
      overdueOwn,
      reasons,
      ...(requests.length && { requests }),
      ...(waitingDays >= 1 && reply && { replyTicketId: reply.id }),
    });
  }
  const ORDER: Record<AlertKind, number> = { client_waiting: 0, client_request: 1, own_overdue: 2, no_progress: 2, awaiting_client: 2 };
  return alerts.sort(
    (x, y) =>
      ORDER[x.kind] - ORDER[y.kind] ||
      y.silentDays - x.silentDays ||
      y.overdueOwn - x.overdueOwn ||
      Number(Boolean(y.attention)) - Number(Boolean(x.attention)) ||
      x.name.localeCompare(y.name, "es"),
  );
}

export interface ReplyQueueItem {
  clientId: string;
  name: string;
  /** Pedidos/consultas por mail sin resolver. */
  count: number;
  /** Del más viejo. */
  oldestAt: string;
  titles: string[];
}

/**
 * Franja "Por responder" del Pulso: cuentas activas (no están en el Pulso porque hubo interacción reciente o reunión)
 * con pedidos/consultas del cliente por mail sin resolver. Abre Responder sin ocupar una tarjeta.
 */
export function replyQueue(clients: ClientRecord[], alerts: AccountAlert[]): ReplyQueueItem[] {
  const inPulse = new Set(alerts.map((a) => a.clientId));
  return clients
    .filter((c) => c.status === "assigned" && !inPulse.has(c.id))
    .flatMap((c) => {
      const open = openMailRequests(c).sort((x, y) => x.date.localeCompare(y.date));
      return open.length ? [{ clientId: c.id, name: c.name, count: open.length, oldestAt: open[0].date, titles: open.map((t) => t.title) }] : [];
    })
    .sort((a, b) => a.oldestAt.localeCompare(b.oldestAt));
}
