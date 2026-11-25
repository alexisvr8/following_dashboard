import type { gmail_v1 } from "googleapis";
import { getDocText } from "@/lib/integrations/drive";
import { collectAccountThreads, MAX_CHARS_PER_MESSAGE } from "@/lib/integrations/account-mails";
import { extractBody, stripHtml, unwrapPlain, withRetry } from "@/lib/integrations/gemini-mail";
import { GEMINI_SENDER, hasCalendarPart, hdr, parseAddresses, parseFrom, sharedExternals } from "@/lib/integrations/client-activity";
import type { ClientRecord, ClientsFile } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import type { AnalysisThread, MailWho } from "@/lib/llm/account-analysis";
import { auditMailSince, auditMeetings, type AuditMeetingDoc } from "@/lib/utils/account-audit";
import { classifyMail, stripQuoted } from "@/lib/utils/mail-classify";
import { applyCorrections, splitNotesAndTranscript } from "@/lib/utils/transcript";

// Fuentes de la auditoría única por cuenta: Docs de Gemini de las últimas reuniones (notas + transcripción
// completa), todos los hilos del período con la cuenta y los hilos de partners compartidos que la mencionan.

const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;
/** Topes de transcripción por reunión (caracteres): la más nueva completa, las anteriores un poco menos. */
const TRANSCRIPT_CAP = [140_000, 80_000, 60_000];
const AUDIT_MAIL_LIMITS = { maxThreads: 40, maxMessages: 250, maxTotalChars: 160_000 };
const PARTNER_THREADS_PER_DOMAIN = 30;
const PARTNER_THREADS_PER_ACCOUNT = 6;
const PARTNER_CHARS_PER_ACCOUNT = 40_000;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function auditMeetingDocs(client: ClientRecord, settings: WorkSettings, now: Date): Promise<AuditMeetingDoc[]> {
  const out: AuditMeetingDoc[] = [];
  const meetings = auditMeetings(client, now);
  for (const [i, m] of meetings.entries()) {
    let notes: string | null = m.summary;
    let transcript: string | null = null;
    let cut = false;
    if (m.docId) {
      try {
        const doc = applyCorrections(await getDocText(m.docId), settings.corrections ?? []);
        const split = splitNotesAndTranscript(doc);
        notes = split.notes ?? notes;
        transcript = split.transcript;
        const cap = TRANSCRIPT_CAP[i] ?? TRANSCRIPT_CAP.at(-1)!;
        if (transcript && transcript.length > cap) {
          transcript = transcript.slice(0, cap);
          cut = true;
        }
      } catch (e) {
        notes = `${notes ?? ""}\n(No se pudo leer el Doc: ${(e as Error).message})`.trim();
      }
    }
    if (!m.docId && m.nextSteps.length) notes = `${notes ?? ""}\nPróximos pasos: ${m.nextSteps.join(" | ")}`.trim();
    out.push({ id: m.id, title: m.title, date: m.date, durationMinutes: m.durationMinutes ?? null, notes, transcript, ...(cut && { cut: true }) });
  }
  return out;
}

export async function auditAccountThreads(gmail: gmail_v1.Gmail, client: ClientRecord, file: ClientsFile, now: Date) {
  const since = auditMailSince(auditMeetings(client, now), now);
  const res = await collectAccountThreads(gmail, client, file.ownerEmail ?? null, sharedExternals(file.clients), since.getTime(), AUDIT_MAIL_LIMITS);
  return { ...res, since };
}

const ACTIVE = new Set(["assigned", "unassigned", "closed", "pending"]);
const NOISE_DOMAIN = /(^|\.)(google\.com|googlegroups\.com|calendar\.|notion\.so|slack\.com|zoom\.us|microsoft\.com|docusign\.net)$/;

/**
 * Partners / devs externos / proveedores del ERP: dominios externos que aparecen en los mails o reuniones de las
 * cuentas activas sin ser de ninguna (acsistec, intecsoft, algoritmo…), externos en 2+ cuentas y vinculados como
 * compartidos. Freemail: solo la dirección, si aparece en 2+ cuentas o vinculada.
 */
export function partnerTargets(file: ClientsFile): string[] {
  const own = file.ownerEmail?.toLowerCase().split("@")[1] ?? "";
  const active = file.clients.filter((c) => ACTIVE.has(c.status));
  const clientDomains = new Set(active.map((c) => c.domain.toLowerCase()).filter((d) => d && !FREEMAIL.test(d)));
  const clientEmails = new Set(active.flatMap((c) => (c.id.includes("@") ? [c.id.toLowerCase(), ...c.contactEmails.map((e) => e.toLowerCase())] : [])));
  const freemailSeen = new Map<string, Set<string>>();
  for (const c of active) {
    const addrs = [
      ...(c.activity?.recentMails ?? []).flatMap((m) => [m.from, ...(m.recipients ?? [])]),
      ...c.meetings.flatMap((m) => (m.attendees ?? []).map((a) => a.email)),
    ];
    for (const raw of addrs) {
      const a = (raw ?? "").toLowerCase();
      const d = a.split("@")[1];
      if (!d || d === own || (own && d.endsWith(`.${own}`)) || d === c.domain || NOISE_DOMAIN.test(d)) continue;
      if (FREEMAIL.test(d)) {
        const s = freemailSeen.get(a) ?? new Set<string>();
        s.add(c.id);
        freemailSeen.set(a, s);
      } else if (!clientDomains.has(d)) freemailSeen.set(`@${d}`, new Set(["*", "**"]));
    }
  }
  const targets = new Set<string>();
  const add = (v: string) => {
    const value = v.trim().toLowerCase().replace(/^@/, "");
    if (!value) return;
    const domain = value.includes("@") ? value.split("@")[1] : value;
    if (domain === own || clientDomains.has(domain) || clientEmails.has(value)) return;
    if (value.includes("@") && FREEMAIL.test(domain)) targets.add(value);
    else if (!FREEMAIL.test(domain)) targets.add(domain);
  };
  for (const e of sharedExternals(file.clients)) add(e);
  for (const c of file.clients) for (const l of c.profile?.linkedContacts ?? []) if (l.shared) add(l.value);
  for (const [a, ids] of freemailSeen) if (ids.size >= 2) add(a);
  return [...targets].sort();
}

export interface PartnerThread extends AnalysisThread {
  id: string;
  partner: string;
  /** Texto normalizado (asunto + mensajes) para buscar menciones de cuentas. */
  haystack: string;
  participants: string[];
}

/** Hilos del período con cada partner (una sola lectura para todas las cuentas). */
export async function collectPartnerThreads(gmail: gmail_v1.Gmail, file: ClientsFile, sinceMs: number): Promise<PartnerThread[]> {
  const me = file.ownerEmail?.toLowerCase() ?? null;
  const own = me?.split("@")[1] ?? "";
  const who = (email: string): MailWho => (email === me ? "yo" : own && email.endsWith(`@${own}`) ? "equipo" : "cliente");
  const out: PartnerThread[] = [];
  const seen = new Set<string>();
  for (const target of partnerTargets(file)) {
    const t = target.includes("@") ? target : `@${target}`;
    const q = `{from:${t} to:${t} cc:${t}} -from:${GEMINI_SENDER} -from:calendar-notification@google.com -in:drafts after:${Math.floor(sinceMs / 1000)}`;
    let ids: string[] = [];
    try {
      const res = await withRetry(() => gmail.users.messages.list({ userId: "me", q, maxResults: 100 }));
      ids = [...new Set((res.data.messages ?? []).flatMap((m) => (m.threadId ? [m.threadId] : [])))].slice(0, PARTNER_THREADS_PER_DOMAIN);
    } catch {
      continue;
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      let th;
      try {
        th = (await withRetry(() => gmail.users.threads.get({ userId: "me", id, format: "full" }))).data;
      } catch {
        continue;
      }
      let subject = "";
      const messages: AnalysisThread["messages"] = [];
      const participants = new Set<string>();
      for (const msg of th.messages ?? []) {
        if (msg.labelIds?.includes("DRAFT")) continue;
        const h = hdr(msg);
        subject ||= (h["subject"] ?? "").replace(/^\s*((re|rv|fw|fwd|tr|res|enc)\s*:\s*)+/i, "").trim();
        const date = Number(msg.internalDate);
        if (date < sinceMs) continue;
        const from = parseFrom(h["from"] ?? "");
        const to = parseAddresses(`${h["to"] ?? ""},${h["cc"] ?? ""}`);
        [from.email, ...to].forEach((e) => participants.add(e));
        if (classifyMail({ subject: h["subject"] ?? "", from: from.email, headers: h, hasCalendarPart: hasCalendarPart(msg.payload ?? undefined) }) !== "message") continue;
        const { text, html } = extractBody(msg.payload ?? undefined);
        const own2 = stripQuoted(text ? unwrapPlain(text) : stripHtml(html)) || msg.snippet || "";
        const side = who(from.email);
        messages.push({
          from: from.email,
          fromName: side === "cliente" ? `${from.name ?? from.email} (partner/externo, ${from.email.split("@")[1]})` : from.name,
          who: side,
          date: new Date(date).toISOString(),
          to,
          text: own2.length > MAX_CHARS_PER_MESSAGE ? `${own2.slice(0, MAX_CHARS_PER_MESSAGE)}…` : own2,
        });
      }
      if (!messages.length) continue;
      out.push({
        id,
        partner: target,
        subject: subject || "(sin asunto)",
        messages,
        participants: [...participants],
        haystack: norm(`${subject} ${messages.map((m) => m.text).join(" ")}`),
      });
    }
  }
  return out;
}

/** Palabras con las que se nombra a la cuenta en un mail (nombre, nombre en correos, dominio). */
export function accountKeywords(client: ClientRecord): string[] {
  const words = [client.name, client.profile?.emailName ?? "", FREEMAIL.test(client.domain) || client.domain.includes("@") ? "" : client.domain.split(".")[0]]
    .map((w) => norm(w).replace(/\b(grupo|group|s\.?a\.?|srl|sas|company)\b/g, "").replace(/\d+/g, "").trim())
    .filter((w) => w.length >= 4);
  return [...new Set(words)];
}

/** Hilos de partner que nombran a la cuenta (o la copian) y no entraron ya por la búsqueda normal. */
export function partnerThreadsFor(client: ClientRecord, all: PartnerThread[], exclude: Set<string>): AnalysisThread[] {
  const keys = accountKeywords(client);
  const domain = FREEMAIL.test(client.domain) || client.domain.includes("@") ? null : client.domain.toLowerCase();
  const hit = (t: PartnerThread) =>
    (domain && t.participants.some((p) => p.endsWith(`@${domain}`))) ||
    keys.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t.haystack));
  const picked: AnalysisThread[] = [];
  let chars = 0;
  for (const t of all) {
    if (exclude.has(t.id) || !hit(t)) continue;
    const size = t.messages.reduce((n, m) => n + m.text.length + 120, 0);
    if (picked.length >= PARTNER_THREADS_PER_ACCOUNT || (chars + size > PARTNER_CHARS_PER_ACCOUNT && picked.length)) break;
    chars += size;
    picked.push({ id: t.id, subject: `${t.subject} [partner: ${t.partner}]`, messages: t.messages });
  }
  return picked;
}
