import type { TrackingStatus } from "@/types/account";
import type { Ticket } from "@/types/ticket";

// Tablero: una card abierta por cliente. Sin dependencias de servidor: el estado se recalcula también
// en el navegador al tildar.

export interface CardSource {
  id: string;
  kind: "meeting" | "mail";
  title: string;
  date: string;
}

export interface BoardCard {
  /** `<cliente>:card-<primera reunión o mail que la abrió>`. */
  id: string;
  accountId: string;
  accountName: string;
  kind: "meeting" | "mail";
  title: string;
  summary: string | null;
  date: string;
  durationMinutes: number | null;
  /** Reuniones y mails que juntó, del más nuevo al más viejo. */
  sources: CardSource[];
  /** Por qué hay que atacarla primero; null si no corresponde. */
  priorityReason: string | null;
  /** Días hábiles sin interacción, para ordenar la columna Prioridad. */
  staleDays: number;
  /** Lugar elegido a mano; vale hasta el próximo tildado de la card. */
  override: { status: TrackingStatus; at: string } | null;
  /** Dueño de los puntos que no son míos (ticket → nombre), para distinguirlos en la card. */
  otherOwners: Record<string, string>;
}

/**
 * Reparte los accionables en cards recorriendo reuniones y mails por fecha: lo nuevo se suma a la card en curso,
 * y solo abre otra si esa ya estaba finalizada cuando llegó. Así hay como máximo una abierta por cliente:
 * si se reabre una card vieja, lo posterior vuelve a sumarse a ella.
 */
export function assignCards(clientId: string, tickets: Ticket[]): void {
  const bySource = new Map<string, Ticket[]>();
  for (const t of tickets) {
    if (t.sourceId) bySource.set(t.sourceId, [...(bySource.get(t.sourceId) ?? []), t]);
  }
  const sources = [...bySource.entries()].sort(
    ([, a], [, b]) => Date.parse(a[0].sourceDate ?? "") - Date.parse(b[0].sourceDate ?? ""),
  );
  let cardId: string | null = null;
  let members: Ticket[] = [];
  for (const [sourceId, own] of sources) {
    const arrived = Date.parse(own[0].sourceDate ?? "");
    const finished = members.every((t) => t.isDone && (!t.doneAt || Date.parse(t.doneAt) <= arrived));
    if (!cardId || finished) {
      cardId = `${clientId}:card-${sourceId}`;
      members = [];
    }
    for (const t of own) t.cardId = cardId;
    members.push(...own);
  }
}

/** Automático: todo tildado → finalizada; sin interacción → prioridad; algo tildado → en curso. */
export function resolveCardStatus(
  card: Pick<BoardCard, "override">,
  priorityReason: string | null,
  total: number,
  done: number,
): TrackingStatus {
  if (card.override) return card.override.status;
  if (total > 0 && done === total) return "tasks_done";
  if (priorityReason) return "tasks_priority";
  return done > 0 ? "tasks_in_progress" : "tasks_generated";
}

/** Lunes 00:00 de la semana de `now`: lo finalizado antes de esto pasa al archivo. */
export function weekStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Puntos que la app mantiene sola (se tildan al detectar el mail): no se editan ni se quitan. */
export const isAutoTicket = (ticketId: string) => /-(followup|reply)$/.test(ticketId);

/** "[Ana Pérez] Enviar X: detalle" → "Enviar X". Para la vista corta de la card. */
export function shortStep(title: string): string {
  const text = title.replace(/^\s*\[[^\]]*\]\s*/, "");
  const head = text.split(":")[0].trim();
  return head.length >= 8 ? head : text;
}
