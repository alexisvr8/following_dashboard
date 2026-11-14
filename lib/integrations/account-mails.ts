import type { gmail_v1 } from "googleapis";
import { extractBody, stripHtml, unwrapPlain, withRetry } from "@/lib/integrations/gemini-mail";
import { clientTargets, GEMINI_SENDER, hasCalendarPart, hdr, parseAddresses, parseFrom } from "@/lib/integrations/client-activity";
import type { ClientRecord } from "@/lib/store/clients-store";
import type { AnalysisThread, MailWho } from "@/lib/llm/account-analysis";
import { classifyMail, stripQuoted } from "@/lib/utils/mail-classify";

// Trazabilidad completa de mails de una cuenta para el análisis semanal: TODOS los hilos con el cliente desde
// `since` (no solo los últimos 8 que guarda la sync), con cada mensaje completo (sin citas), en cualquier
// dirección. Mismos filtros que la sync: sin minutas, invitaciones, auto-respuestas, borradores ni automatizaciones.

const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;
const MAX_MESSAGES = 150;
const MAX_THREADS = 25;
const MAX_CHARS_PER_MESSAGE = 3500;
/** Tope total de texto de mails que se manda al modelo (~25k tokens). */
const MAX_TOTAL_CHARS = 100_000;

export interface AccountThreadsResult {
  threads: AnalysisThread[];
  messages: number;
  /** Se dejaron hilos afuera por el tope de texto. */
  truncated: boolean;
}

export async function collectAccountThreads(
  gmail: gmail_v1.Gmail,
  client: ClientRecord,
  ownerEmail: string | null,
  shared: Set<string>,
  sinceMs: number,
): Promise<AccountThreadsResult> {
  const { query, matches } = clientTargets(client, ownerEmail, shared);
  if (!query.length) return { threads: [], messages: 0, truncated: false };
  const or = query.join(" OR ");
  const me = ownerEmail?.toLowerCase() ?? null;
  const ownDomain = me?.split("@")[1] ?? "";
  const who = (email: string): MailWho =>
    email === me ? "yo" : ownDomain && !FREEMAIL.test(ownDomain) && email.endsWith(`@${ownDomain}`) ? "equipo" : "cliente";

  // 1) Ids de hilos con actividad en el período (más nuevo primero).
  const q = `{from:(${or}) to:(${or}) cc:(${or})} -from:${GEMINI_SENDER} -from:calendar-notification@google.com -in:drafts after:${Math.floor(sinceMs / 1000)}`;
  const threadIds: string[] = [];
  let pageToken: string | undefined;
  let seen = 0;
  do {
    const res = await withRetry(() => gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken }));
    for (const m of res.data.messages ?? []) {
      seen++;
      if (m.threadId && !threadIds.includes(m.threadId)) threadIds.push(m.threadId);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && seen < MAX_MESSAGES && threadIds.length < MAX_THREADS);

  // 2) Cada hilo completo, solo los mensajes reales del período.
  const threads: (AnalysisThread & { last: string })[] = [];
  for (const id of threadIds.slice(0, MAX_THREADS)) {
    const th = (await withRetry(() => gmail.users.threads.get({ userId: "me", id, format: "full" }))).data;
    const messages: AnalysisThread["messages"] = [];
    let subject = "";
    for (const msg of th.messages ?? []) {
      if (msg.labelIds?.includes("DRAFT")) continue;
      const date = Number(msg.internalDate);
      const h = hdr(msg);
      subject ||= (h["subject"] ?? "").replace(/^\s*((re|rv|fw|fwd|tr|res|enc)\s*:\s*)+/i, "").trim();
      if (date < sinceMs) continue;
      const from = parseFrom(h["from"] ?? "");
      const side = who(from.email);
      // Del lado cliente solo cuentan remitentes reconocidos (evita terceros que nos copian).
      if (side === "cliente" && !matches(from.email)) continue;
      const kind = classifyMail({
        subject: h["subject"] ?? "",
        from: from.email,
        headers: h,
        hasCalendarPart: hasCalendarPart(msg.payload ?? undefined),
      });
      if (kind !== "message") continue;
      const { text, html } = extractBody(msg.payload ?? undefined);
      const own = stripQuoted(text ? unwrapPlain(text) : stripHtml(html)) || msg.snippet || "";
      messages.push({
        from: from.email,
        fromName: from.name,
        who: side,
        date: new Date(date).toISOString(),
        to: parseAddresses(`${h["to"] ?? ""},${h["cc"] ?? ""}`),
        text: own.length > MAX_CHARS_PER_MESSAGE ? `${own.slice(0, MAX_CHARS_PER_MESSAGE)}…` : own,
      });
    }
    if (!messages.length) continue;
    // Hilo de la cuenta: escribe alguien del cliente o yo (descarta reportes de terceros con copia).
    if (!messages.some((m) => m.who === "cliente" || m.who === "yo")) continue;
    threads.push({ subject: subject || "(sin asunto)", messages, last: messages.at(-1)!.date });
  }

  // 3) Tope de texto: entran primero los hilos con movimiento más reciente.
  threads.sort((a, b) => b.last.localeCompare(a.last));
  const out: AnalysisThread[] = [];
  let total = 0;
  let truncated = false;
  for (const t of threads) {
    const size = t.messages.reduce((n, m) => n + m.text.length + 120, t.subject.length);
    if (total + size > MAX_TOTAL_CHARS && out.length) {
      truncated = true;
      continue;
    }
    total += size;
    out.push({ subject: t.subject, messages: t.messages });
  }
  return { threads: out, messages: out.reduce((n, t) => n + t.messages.length, 0), truncated };
}
