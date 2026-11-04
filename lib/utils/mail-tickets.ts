import type { ClientRecord, MailRef } from "@/lib/store/clients-store";
import { accountActionables } from "@/lib/utils/actionables";
import { keywordSimilarity } from "@/lib/utils/mail-classify";
import { collectMailItems, fmtMailDate as fmt, isRecapMail, mailAuthor as who, mailTicketId } from "@/lib/utils/mail-items";

export { isRecapMail };

// Accionables de mails. Persisten en `doneTicketIds`:
// - último mail del cliente: "Responder a X", abierto hasta tildarlo o responderle por mail;
// - pedidos y compromisos detectados en cualquier mail (ver mail-items.ts): siguen abiertos aunque lleguen otros
//   mails o reuniones, salvo que repitan algo ya listado. Cerrados, se ven 28 días y luego quedan en Ejecutadas.

export interface MailTicket {
  id: string;
  messageId: string;
  subject: string;
  title: string;
  description: string;
  date: string;
  kind: "reply" | "request" | "commitment";
}

const SAME_STEP = 0.6;
const KEEP_CLOSED_MS = 28 * 86_400_000;

export function mailTickets(client: ClientRecord): MailTicket[] {
  const latest = client.meetings.reduce<string | null>((max, m) => (!max || m.date > max ? m.date : max), null);
  const done = new Set(client.doneTicketIds ?? []);
  const at = client.doneTicketAt ?? {};
  const out: MailTicket[] = [];

  const mail = client.activity?.lastInboundMail;
  if (mail) {
    const id = mailTicketId(client.id, mail.messageId, "reply");
    // Anterior a la reunión: solo interesa si sigue sin responder; ya respondido no aporta nada.
    if (!latest || mail.date > latest || !done.has(id)) {
      out.push({
        id,
        messageId: mail.messageId,
        subject: mail.subject,
        title: `Responder a ${who(mail)}: “${mail.subject}”`,
        description: `Mail de ${who(mail)} (${fmt(mail.date)}): “${mail.subject}”`,
        date: mail.date,
        kind: "reply",
      });
    }
  }

  const steps = accountActionables(client).map((a) => a.step);
  const kept: string[] = [];
  const items = Object.values(collectMailItems(client)).sort((a, b) => b.date.localeCompare(a.date));
  for (const item of items) {
    if (done.has(item.id)) {
      if (Date.now() - Date.parse(at[item.id] ?? item.date) <= KEEP_CLOSED_MS) out.push(item);
      continue;
    }
    // Un pedido repetido en otro mail, o que la minuta ya lista, no suma un punto más.
    if ([...steps, ...kept].some((s) => keywordSimilarity(s, item.title) >= SAME_STEP)) continue;
    kept.push(item.title);
    out.push(item);
  }

  const edits = client.actionableEdits ?? {};
  const removed = new Set(client.removedTicketIds ?? []);
  return out.filter((t) => !removed.has(t.id)).map((t) => ({ ...t, title: edits[t.id] ?? t.title }));
}

/**
 * Nota de trazabilidad para un ticket de minuta según el mail más reciente que lo trata:
 * mío/del equipo → "posiblemente resuelto"; del cliente → "mencionado por".
 */
export function relatedMailNote(client: ClientRecord, ticketId: string): string | undefined {
  const mails: MailRef[] = client.activity?.recentMails ?? client.activity?.recentInbound ?? [];
  const mail = mails.find((m) => m.relatedTicketIds.includes(ticketId) && !isRecapMail(m));
  if (!mail) return undefined;
  if (mail.direction === "me" || mail.direction === "team") {
    return `Posiblemente resuelto: mail de ${mail.direction === "me" ? "vos" : who(mail)} (${fmt(mail.date)}) “${mail.subject}”`;
  }
  return `Mencionado por ${who(mail)} (${fmt(mail.date)}): “${mail.subject}”`;
}
