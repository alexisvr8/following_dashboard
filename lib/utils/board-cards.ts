import type { ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { isOwnActionable } from "@/lib/utils/capacity";
import { businessDaysSince, lastMovement } from "@/lib/utils/followup-alerts";
import type { BoardCard, CardSource } from "@/lib/utils/board-status";
import type { Ticket } from "@/types/ticket";

const plural = (n: number) => `${n} día${n === 1 ? "" : "s"} hábil${n === 1 ? "" : "es"}`;

/**
 * Prioridad: el cliente espera respuesta (≥1 día hábil), o pasaron `staleBusinessDays` sin movimiento en
 * la cuenta ni tildes en la card. Si lo último es un mail nuestro sin respuesta no entra: ya interactuamos.
 */
function priority(
  client: ClientRecord,
  own: Ticket[],
  settings: WorkSettings,
  now: Date,
): { reason: string | null; days: number } {
  const open = own.filter((t) => !t.isDone);
  if (!open.length) return { reason: null, days: 0 };
  const reply = open.find((t) => t.id.endsWith("-reply"));
  if (reply?.meetingDate) {
    const days = businessDaysSince(reply.meetingDate, now, settings.workDays);
    if (days >= 1) return { reason: `El cliente espera respuesta hace ${plural(days)}`, days };
  }
  const movement = lastMovement(client, now);
  const lastTick = own.map((t) => t.doneAt).filter((x): x is string => !!x).sort().at(-1);
  const since = [movement?.at, lastTick].filter((x): x is string => !!x).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  if (!since || movement?.mine) return { reason: null, days: 0 };
  const days = businessDaysSince(since, now, settings.workDays);
  return days >= settings.staleBusinessDays
    ? { reason: `Sin interacción hace ${plural(days)}`, days }
    : { reason: null, days: 0 };
}

/** Una fila por card ya agrupada en `clientsToBoard` (`Ticket.cardId`): como máximo una abierta por cliente. */
export function buildBoardCards(
  clients: ClientRecord[],
  tickets: Ticket[],
  settings: WorkSettings,
  now = new Date(),
): BoardCard[] {
  const cards: BoardCard[] = [];
  for (const client of clients) {
    const byCard = new Map<string, Ticket[]>();
    for (const t of tickets) {
      if (t.accountId !== client.id || !t.cardId) continue;
      byCard.set(t.cardId, [...(byCard.get(t.cardId) ?? []), t]);
    }
    for (const [id, own] of byCard) {
      const unique = new Map<string, CardSource>();
      for (const t of own) {
        if (t.sourceId && !unique.has(t.sourceId)) {
          unique.set(t.sourceId, { id: t.sourceId, kind: t.sourceKind ?? "meeting", title: t.sourceTitle ?? "", date: t.sourceDate ?? now.toISOString() });
        }
      }
      const sources = [...unique.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const newest = sources[0];
      // El título y el resumen son los de lo último que entró; el resto se ve agrupado en el Dialog.
      const lastMeeting = client.meetings.find((m) => m.id === sources.find((s) => s.kind === "meeting")?.id);
      const { reason, days } = priority(client, own, settings, now);
      // Lo ubicado a mano deja de valer si después entró algo nuevo.
      const override = client.boardOverrides?.[id] ?? null;
      cards.push({
        id,
        accountId: client.id,
        accountName: client.name,
        kind: newest.kind,
        title: newest.title,
        summary: lastMeeting?.summary ?? null,
        date: newest.date,
        durationMinutes: newest.kind === "meeting" ? (lastMeeting?.durationMinutes ?? null) : null,
        sources,
        priorityReason: reason,
        staleDays: days,
        override: override && Date.parse(override.at) >= Date.parse(newest.date) ? override : null,
        otherOwners: Object.fromEntries(
          own.flatMap((t) => {
            const owner = t.title.match(/^\s*\[([^\]]+)\]/)?.[1];
            return owner && !isOwnActionable(t.title, settings) ? [[t.id, owner.split(/[\s,]+/)[0]]] : [];
          }),
        ),
      });
    }
  }
  return cards.sort((a, b) => b.staleDays - a.staleDays || Date.parse(b.date) - Date.parse(a.date));
}
