import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "./google-client";
import { extractBody, mapLimit, stripHtml, unwrapPlain, withRetry } from "./gemini-mail";
import { clientTargets, GEMINI_SENDER, hdr, parseAddresses, parseFrom, sharedExternals } from "./client-activity";
import type { ClientRecord, ClientsFile } from "@/lib/store/clients-store";
import {
  getUnassignedMails,
  saveUnassignedScan,
  type MailSuggestion,
  type UnassignedMail,
} from "@/lib/store/unassigned-mail-store";
import { accountActionables } from "@/lib/utils/actionables";
import { classifyMail, isAutomationSubject, keywordSimilarity, stripQuoted } from "@/lib/utils/mail-classify";

// Capa C: mails externos dirigidos a mí (Para/Cc) de los últimos 15 días que la sync no asignó a ninguna cuenta.
// Solo entran si el remitente es recurrente (2+ mails en el período o le respondí) o si hay una pista de cuenta, para
// no llenar la bandeja de ruido. Las sugerencias son pistas por reglas (sin IA); siempre decido yo.

const WINDOW_DAYS = 15;
const MAX_MESSAGES = 100;
const MAX_CANDIDATES = 30;
const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;
/** Palabras de razón social que no identifican a una cuenta. */
const GENERIC = new Set([
  "grupo", "group", "company", "compania", "agro", "agropecuaria", "distribuciones", "distribuidora", "alimentos",
  "sociedad", "argentina", "peru", "chile", "uruguay", "global", "servicios", "soluciones", "industrial", "comercial",
  "internacional", "holding", "consulting", "sistemas", "logistica", "tecnologia",
]);

/** Notificaciones de herramientas (tableros, tickets, repos, chat): no son una persona escribiendo. */
const TOOL_SENDER =
  /(^|\.)(trello|atlassian|jira|asana|monday|clickup|notion|slack|github|gitlab|bitbucket|figma|miro|zoom|calendly|hubspot|zendesk|freshdesk|intercom|docusign|google|microsoft|linkedin)\.(com|net|io|so|us|app)$/i;

/** Una vez cada tanto en la sync automática (el escaneo hace muchas llamadas a Gmail). */
export const UNASSIGNED_SCAN_EVERY_MS = 30 * 60_000;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Cómo se puede nombrar a la cuenta en un mail: nombre, nombre en correos, palabra distintiva, dominio. */
function accountTokens(c: ClientRecord): string[] {
  const words = [c.name, c.profile?.emailName ?? ""]
    .flatMap((n) => norm(n).split(/[^a-z0-9]+/))
    .filter((w) => w.length >= 5 && !GENERIC.has(w) && !/^\d+$/.test(w));
  const label = FREEMAIL.test(c.domain) ? null : norm(c.domain.split(".")[0]);
  return [...new Set([norm(c.name).trim(), ...words, ...(label && label.length >= 4 ? [label] : [])])].filter((t) => t.length >= 4);
}

const hasWord = (text: string, token: string) => new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);

export function suggestFor(
  assigned: ClientRecord[],
  sender: string,
  subject: string,
  fullText: string,
  ownText: string,
): MailSuggestion[] {
  const text = norm(`${subject}\n${fullText}`);
  const own = `${subject}\n${ownText}`;
  const out: MailSuggestion[] = [];
  for (const c of assigned) {
    const reasons: string[] = [];
    let strength = 0;
    const named = accountTokens(c).find((t) => hasWord(text, t));
    if (named) {
      reasons.push(`Lo nombra: «${named}»`);
      strength = 3;
    }
    const shared = (c.profile?.linkedContacts ?? []).find(
      (l) => l.shared && (l.value.includes("@") ? sender === l.value : sender.endsWith(`@${l.value}`)),
    );
    if (shared) {
      reasons.push(`Dominio compartido vinculado (@${sender.split("@")[1]})`);
      strength = Math.max(strength, 2);
    }
    if (!FREEMAIL.test(c.domain) && text.includes(`@${norm(c.domain)}`)) {
      reasons.push(`Cita un mail con @${c.domain}`);
      strength = Math.max(strength, 2);
    }
    const act = accountActionables(c).find((a) => !a.done && keywordSimilarity(a.step, own) >= 0.5);
    if (act) {
      reasons.push(`Habla de «${act.step.replace(/^\s*\[[^\]]+\]\s*/, "").split(":")[0].slice(0, 60)}»`);
      strength = Math.max(strength, 1);
    }
    if (strength) out.push({ clientId: c.id, name: c.name, reasons, strength });
  }
  return out.sort((a, b) => b.strength - a.strength).slice(0, 3);
}

export async function scanUnassignedMails(file: ClientsFile): Promise<{ found: number } | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth });
  const me = file.ownerEmail?.toLowerCase() ?? null;
  const ownDomain = me?.split("@")[1] ?? "";
  const assigned = file.clients.filter((c) => c.status === "assigned");
  const shared = sharedExternals(file.clients);
  // Lo que ya es de una cuenta de la app, en cualquier estado (asignada, por validar, cerrada, ignorada): direcciones
  // del cliente, vinculados exclusivos y hilos conocidos. Eso no es "sin cuenta".
  const matchers = file.clients.map((c) => clientTargets(c, file.ownerEmail ?? null, shared).matches);
  const known = new Set(
    file.clients.flatMap((c) => [
      ...(c.activity?.recentMails ?? []).map((m) => m.threadId),
      ...(c.profile?.linkedThreads ?? []).map((t) => t.threadId),
    ]),
  );
  const state = await getUnassignedMails();
  const dismissed = new Set(state.dismissedThreads);
  const previous = new Map(state.items.map((i) => [i.threadId, i]));
  const ours = (e: string) => e === me || (!!ownDomain && !FREEMAIL.test(ownDomain) && e.endsWith(`@${ownDomain}`));

  const q = [
    "{to:me cc:me}",
    "-from:me",
    ...(ownDomain && !FREEMAIL.test(ownDomain) ? [`-from:@${ownDomain}`] : []),
    `-from:${GEMINI_SENDER}`,
    "-from:calendar-notification@google.com",
    "-in:drafts -in:chats -category:promotions -category:social -category:forums",
    `newer_than:${WINDOW_DAYS}d`,
  ].join(" ");
  const list = await withRetry(() => gmail.users.messages.list({ userId: "me", q, maxResults: MAX_MESSAGES }));

  // Último mensaje externo por hilo + cuántos mails mandó cada remitente en el período.
  const byThread = new Map<string, { msg: gmail_v1.Schema$Message; h: Record<string, string>; from: ReturnType<typeof parseFrom> }>();
  const senderCount = new Map<string, number>();
  const todo = (list.data.messages ?? []).filter((m) => m.threadId && !known.has(m.threadId) && !dismissed.has(m.threadId));
  const metas = await mapLimit(todo, 4, async ({ id }) =>
    (
      await withRetry(() =>
        gmail.users.messages.get({
          userId: "me",
          id: id!,
          format: "metadata",
          metadataHeaders: ["From", "To", "Cc", "Subject", "Auto-Submitted", "List-Unsubscribe", "Precedence", "X-Autoreply"],
        }),
      )
    ).data,
  );
  for (const msg of metas) {
    const threadId = msg.threadId!;
    const h = hdr(msg);
    const from = parseFrom(h["from"] ?? "");
    if (!from.email || ours(from.email)) continue;
    if (state.ignoredSenders.includes(from.email) || state.ignoredDomains.some((d) => from.email.endsWith(`@${d}`))) continue;
    // Envíos masivos / automáticos: no son de una persona.
    if (h["list-unsubscribe"] || /bulk|list/i.test(h["precedence"] ?? "") || /no-?reply|notifications?|mailer-daemon/i.test(from.email)) continue;
    if (TOOL_SENDER.test(from.email.split("@")[1] ?? "")) continue;
    if (classifyMail({ subject: h["subject"] ?? "", from: from.email, headers: h, hasCalendarPart: false }) !== "message") continue;
    if (isAutomationSubject(h["subject"] ?? "")) continue;
    // Si aparece alguien de una cuenta, la sync ya lo asigna (o lo descartó a propósito por ambiguo).
    const addrs = [from.email, ...parseAddresses(`${h["to"] ?? ""},${h["cc"] ?? ""}`)];
    if (addrs.some((a) => matchers.some((m) => m(a)))) continue;
    senderCount.set(from.email, (senderCount.get(from.email) ?? 0) + 1);
    const cur = byThread.get(threadId);
    if (!cur || Number(msg.internalDate) > Number(cur.msg.internalDate)) byThread.set(threadId, { msg, h, from });
  }

  const items: UnassignedMail[] = [];
  const candidates = [...byThread.entries()]
    .sort((a, b) => Number(b[1].msg.internalDate) - Number(a[1].msg.internalDate))
    .slice(0, MAX_CANDIDATES);
  for (const [threadId, { msg, h, from }] of candidates) {
    // Sin cambios desde el escaneo anterior: se reusa (menos llamadas a Gmail).
    const prev = previous.get(threadId);
    if (prev && prev.messageId === msg.id) {
      items.push(prev);
      continue;
    }
    const full = (await withRetry(() => gmail.users.messages.get({ userId: "me", id: msg.id!, format: "full" }))).data;
    const { text, html } = extractBody(full.payload ?? undefined);
    const raw = text ? unwrapPlain(text) : stripHtml(html);
    const ownText = stripQuoted(raw) || full.snippet || "";
    const th = (
      await withRetry(() => gmail.users.threads.get({ userId: "me", id: threadId, format: "metadata", metadataHeaders: ["From"] }))
    ).data;
    const iWrote = (th.messages ?? []).some((m) => ours(parseFrom(hdr(m)["from"] ?? "").email));
    const subject = h["subject"] || "(sin asunto)";
    const suggestions = suggestFor(assigned, from.email, subject, raw, ownText);
    // Filtro de ruido: remitente recurrente, le respondí, o hay pista de cuenta.
    if (!suggestions.length && !iWrote && (senderCount.get(from.email) ?? 0) < 2) continue;
    items.push({
      threadId,
      messageId: msg.id!,
      from: from.email,
      fromName: from.name,
      subject,
      date: new Date(Number(msg.internalDate)).toISOString(),
      excerpt: ownText.replace(/\s+/g, " ").trim().slice(0, 400),
      messages: th.messages?.length ?? 1,
      iWrote,
      suggestions,
    });
  }
  await saveUnassignedScan(items.sort((a, b) => b.date.localeCompare(a.date)));
  return { found: items.length };
}
