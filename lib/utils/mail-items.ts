import type { ClientRecord, MailRef } from "@/lib/store/clients-store";
import { isAutomationSubject, isOurTemplateText } from "@/lib/utils/mail-classify";

// Pedidos (mails del cliente) y compromisos (mails míos) detectados. `recentMails` solo guarda los últimos
// mails, así que se conservan en `client.mailActionables`: un punto abierto no desaparece cuando llegan otros.

/** Tickets derivados de un mail: "-reply", y uno por pedido o compromiso detectado. */
export const mailTicketId = (clientId: string, messageId: string, suffix: string | number) =>
  `${clientId}:mail-${messageId}-${suffix}`;

/** Misma fecha de corte que las minutas (`CARRY_OVER_SINCE`): antes de esto no se podían tildar. */
const SINCE = Date.parse("2026-10-31T00:00:00");

export interface MailItem {
  id: string;
  messageId: string;
  /** Hilo del mail (para dar el pedido por respondido si contestamos en ese hilo). */
  threadId?: string;
  title: string;
  subject: string;
  description: string;
  date: string;
  kind: "request" | "commitment";
}

export const fmtMailDate = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" });
export const mailAuthor = (m: MailRef) => m.fromName ?? m.from;

/**
 * Mail nuestro que repasa varios accionables (minuta, resumen, seguimiento): coincide por palabras
 * con todos porque los enumera, así que no indica que se haya avanzado en ninguno.
 */
export const isRecapMail = (mail: MailRef) =>
  (mail.direction === "me" || mail.direction === "team") && mail.relatedTicketIds.length >= 3;

/** Lo guardado más lo que traen los mails actuales. */
export function collectMailItems(client: ClientRecord): Record<string, MailItem> {
  // Lo guardado antes del filtro de automatizaciones (planillas CMA, etc.) se descarta.
  const items: Record<string, MailItem> = Object.fromEntries(
    Object.entries(client.mailActionables ?? {}).filter(([, v]) => !isAutomationSubject(v.subject)),
  );
  for (const m of client.activity?.recentMails ?? client.activity?.recentInbound ?? []) {
    if (Date.parse(m.date) < SINCE || isAutomationSubject(m.subject)) continue;
    const base = { messageId: m.messageId, threadId: m.threadId, subject: m.subject, date: m.date };
    if (m.direction === "me" && !isRecapMail(m)) {
      (m.commitments ?? []).forEach((title, i) => {
        const id = mailTicketId(client.id, m.messageId, `c${i}`);
        const description = `Compromiso en tu mail (${fmtMailDate(m.date)}): “${m.subject}”`;
        items[id] = { ...base, id, title, description, kind: "commitment" };
      });
    } else if (m.direction === "client" || m.direction === undefined) {
      (m.requests ?? []).forEach((title, i) => {
        if (isOurTemplateText(title)) return;
        const id = mailTicketId(client.id, m.messageId, i);
        const description = `Pedido en mail de ${mailAuthor(m)} (${fmtMailDate(m.date)}): “${m.subject}”`;
        items[id] = { ...base, id, title, description, kind: "request" };
      });
    }
  }
  // Pedidos que en realidad eran texto citado de nuestros mails ("Status: Pendiente ⏳"): se descartan.
  for (const [id, item] of Object.entries(items)) if (item.kind === "request" && isOurTemplateText(item.title)) delete items[id];
  return items;
}

/**
 * Pedidos del cliente ya contestados: hay un mail nuestro (mío o del equipo) posterior en el mismo hilo. Lo usa la
 * sync para tildarlos solos; un pedido de otro hilo sigue abierto hasta responderlo ahí (o enviar la Respuesta).
 */
export function answeredRequests(client: ClientRecord, items: Record<string, MailItem>): { id: string; at: string }[] {
  const mails = [...(client.activity?.recentMails ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const threadOf = new Map(mails.map((m) => [m.messageId, m.threadId]));
  const done = new Set(client.doneTicketIds ?? []);
  return Object.values(items).flatMap((i) => {
    if (i.kind !== "request" || done.has(i.id)) return [];
    const thread = i.threadId ?? threadOf.get(i.messageId);
    // La primera respuesta nuestra posterior: el pedido quedó respondido en esa fecha (no en la de la sync).
    const answer = thread && mails.find((m) => m.threadId === thread && (m.direction === "me" || m.direction === "team") && m.date > i.date);
    return answer ? [{ id: i.id, at: answer.date }] : [];
  });
}
