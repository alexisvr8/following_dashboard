import type { ClientRecord, MailRef } from "@/lib/store/clients-store";

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
  const items: Record<string, MailItem> = { ...client.mailActionables };
  for (const m of client.activity?.recentMails ?? client.activity?.recentInbound ?? []) {
    if (Date.parse(m.date) < SINCE) continue;
    const base = { messageId: m.messageId, subject: m.subject, date: m.date };
    if (m.direction === "me" && !isRecapMail(m)) {
      (m.commitments ?? []).forEach((title, i) => {
        const id = mailTicketId(client.id, m.messageId, `c${i}`);
        const description = `Compromiso en tu mail (${fmtMailDate(m.date)}): “${m.subject}”`;
        items[id] = { ...base, id, title, description, kind: "commitment" };
      });
    } else if (m.direction === "client" || m.direction === undefined) {
      (m.requests ?? []).forEach((title, i) => {
        const id = mailTicketId(client.id, m.messageId, i);
        const description = `Pedido en mail de ${mailAuthor(m)} (${fmtMailDate(m.date)}): “${m.subject}”`;
        items[id] = { ...base, id, title, description, kind: "request" };
      });
    }
  }
  return items;
}
