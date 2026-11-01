import { mailTicketId, type ClientRecord, type MailRef } from "@/lib/store/clients-store";

// Accionables derivados del último mail del cliente (si es posterior a la última reunión):
// "Responder a X" + un ticket por pedido/pregunta detectado. Persisten en `doneTicketIds`.

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" });
const who = (m: MailRef) => m.fromName ?? m.from;

export interface MailTicket {
  id: string;
  title: string;
  description: string;
  date: string;
}

export function mailTickets(client: ClientRecord): MailTicket[] {
  const mail = client.activity?.lastInboundMail;
  if (!mail) return [];
  const latest = client.meetings.reduce<string | null>((max, m) => (!max || m.date > max ? m.date : max), null);
  if (latest && mail.date <= latest) return []; // ya cubierto por la reunión
  const desc = `Mail de ${who(mail)} (${fmt(mail.date)}): “${mail.subject}”`;
  return [
    { id: mailTicketId(client.id, mail.messageId, "reply"), title: `Responder a ${who(mail)}: “${mail.subject}”`, description: desc, date: mail.date },
    ...(mail.requests ?? []).map((r, i) => ({
      id: mailTicketId(client.id, mail.messageId, i),
      title: r,
      description: `Pedido en ${desc.charAt(0).toLowerCase()}${desc.slice(1)}`,
      date: mail.date,
    })),
  ];
}

/**
 * Nota de trazabilidad para un ticket de minuta según el mail más reciente que lo trata:
 * mío/del equipo → "posiblemente resuelto"; del cliente → "mencionado por".
 */
export function relatedMailNote(client: ClientRecord, ticketId: string): string | undefined {
  const mails = client.activity?.recentMails ?? client.activity?.recentInbound ?? [];
  const mail = mails.find((m) => m.relatedTicketIds.includes(ticketId));
  if (!mail) return undefined;
  if (mail.direction === "me" || mail.direction === "team") {
    return `Posiblemente resuelto: mail de ${mail.direction === "me" ? "vos" : who(mail)} (${fmt(mail.date)}) “${mail.subject}”`;
  }
  return `Mencionado por ${who(mail)} (${fmt(mail.date)}): “${mail.subject}”`;
}
