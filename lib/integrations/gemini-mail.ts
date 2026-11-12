import { google, type gmail_v1, type calendar_v3 } from "googleapis";
import { getAuthorizedClient } from "./google-client";
import { getDocText } from "./drive";
import { parseGeminiNotes } from "@/lib/utils/gemini-notes-parser";
import { applyCorrections, extractSuggestions, type TranscriptSuggestion } from "@/lib/utils/transcript";
import { getSettings } from "@/lib/store/settings-store";
import type {
  ClientsFile,
  DiscoveredClient,
  DiscoveredMeeting,
  DiscoveryResult,
  MeetingAttendee,
} from "@/lib/store/clients-store";
import { eventKey } from "@/lib/store/clients-store";

// Descubre clientes desde los mails de Gemini Notes: mail → evento de Calendar (por Doc
// adjunto o título+fecha) → asistentes externos → dominio → empresa.

const GEMINI_SENDER = process.env.GEMINI_NOTES_SENDER ?? "gemini-notes@google.com";
const MAX_MESSAGES = 300;
const CONCURRENCY = 3;
const DAY_MS = 86_400_000;

// Por proveedor, no por dominio exacto: cubre yahoo.com.ar, hotmail.es, etc.
const FREEMAIL_PROVIDERS = new Set([
  "gmail", "googlemail", "hotmail", "outlook", "live", "msn", "yahoo", "icloud", "proton", "protonmail",
]);
const isFreemail = (domain: string) => FREEMAIL_PROVIDERS.has(domain.split(".")[0]);
const IGNORED_DOMAINS = new Set(["google.com", "resource.calendar.google.com"]);
const GENERIC_LABELS = new Set(["com", "co", "net", "org", "gob", "gov", "edu", "io", "ai", "app"]);

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Reintenta ante rate limit de Google (429 / 403 rateLimitExceeded) con backoff exponencial.
export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const e = error as { code?: number; status?: number; message?: string };
      const code = e.code ?? e.status;
      const rateLimited = code === 429 || (code === 403 && /quota|rate/i.test(e.message ?? ""));
      if (!rateLimited || attempt >= tries - 1) throw error;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 2000 + Math.random() * 500));
    }
  }
}

function decode(data?: string | null): string {
  return data ? Buffer.from(data, "base64url").toString("utf-8") : "";
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractBody(payload?: gmail_v1.Schema$MessagePart): { text: string; html: string } {
  let text = "";
  let html = "";
  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && !text) text = decode(part.body?.data);
    if (part.mimeType === "text/html" && !html) html = decode(part.body?.data);
    part.parts?.forEach(walk);
  };
  walk(payload);
  return { text, html };
}

export function header(msg: gmail_v1.Schema$Message, name: string): string {
  return (
    msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

function titleFromSubject(subject: string): string {
  const quoted = subject.match(/[“"«](.+?)[”"»]/);
  if (quoted) return quoted[1].trim();
  return subject.replace(/^(notas|notes)(\s+(by|de)\s+gemini)?\s*[:\-–]\s*/i, "").trim();
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function companyNameFromDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".");
  while (labels.length > 1 && (GENERIC_LABELS.has(labels.at(-1)!) || labels.at(-1)!.length === 2)) {
    labels.pop();
  }
  const base = labels.at(-1) ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function listGeminiMessageIds(gmail: gmail_v1.Gmail, days: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        q: `from:${GEMINI_SENDER} newer_than:${days}d`,
        maxResults: 100,
        pageToken,
      }),
    );
    ids.push(...(res.data.messages ?? []).map((m) => m.id!));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_MESSAGES);
  return ids.slice(0, MAX_MESSAGES);
}

async function listEvents(calendar: calendar_v3.Calendar, days: number) {
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date(Date.now() - (days + 1) * DAY_MS).toISOString(),
      timeMax: new Date().toISOString(),
      singleEvents: true,
      maxResults: 250,
      pageToken,
    });
    events.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return events;
}

function eventStart(e: calendar_v3.Schema$Event): number {
  return new Date(e.start?.dateTime ?? e.start?.date ?? 0).getTime();
}

function eventMinutes(e: calendar_v3.Schema$Event): number | null {
  if (!e.start?.dateTime || !e.end?.dateTime) return null; // eventos de día completo
  return Math.round((new Date(e.end.dateTime).getTime() - eventStart(e)) / 60_000);
}

function eventAttendees(e: calendar_v3.Schema$Event): MeetingAttendee[] {
  return (e.attendees ?? [])
    .filter((a) => {
      const domain = a.email?.split("@")[1]?.toLowerCase();
      return domain && !a.resource && !IGNORED_DOMAINS.has(domain);
    })
    .map((a) => ({ email: a.email!.toLowerCase(), name: a.displayName ?? null }));
}

const BACKFILL_PER_RUN = 25;

/**
 * Lee de nuevo los Docs de minutas guardadas antes de extraer hitos/decisiones (el escaneo saltea
 * los mails ya procesados). Por tandas, de la más nueva a la más vieja. Si el Doc ya no es accesible
 * se marca vacío para no reintentarlo; ante cualquier otro error se reintenta en la próxima corrida.
 */
export async function backfillMeetingNotes(file: ClientsFile) {
  const seen = new Set<string>();
  const pending = file.clients
    .filter((c) => c.status === "assigned" || c.status === "unassigned")
    .flatMap((c) => c.meetings)
    .filter((m) => m.docId && m.milestones === undefined && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, BACKFILL_PER_RUN);

  const updates = await mapLimit(pending, CONCURRENCY, async (m) => {
    try {
      const { milestones, decisions } = parseGeminiNotes(await withRetry(() => getDocText(m.docId!)));
      return { meetingId: m.id, milestones, decisions };
    } catch (error) {
      const code = (error as { code?: number; status?: number }).code ?? (error as { status?: number }).status;
      return code === 403 || code === 404 ? { meetingId: m.id, milestones: [], decisions: [] } : null;
    }
  });
  return updates.filter((u) => u !== null);
}

const TRANSCRIPT_DAYS = 30;

/**
 * Sugerencias de la transcripción para minutas recientes (≤30 días) de clientes validados que aún no se
 * procesaron (`transcript === undefined`), por tandas. Sin acceso al Doc → `[]` (no se reintenta).
 */
export async function backfillTranscripts(file: ClientsFile) {
  const { corrections } = await getSettings();
  const since = Date.now() - TRANSCRIPT_DAYS * 86_400_000;
  const seen = new Set<string>();
  const pending = file.clients
    .filter((c) => c.status === "assigned" || c.status === "unassigned")
    .flatMap((c) => c.meetings)
    .filter((m) => m.docId && m.transcript === undefined && Date.parse(m.date) >= since && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, BACKFILL_PER_RUN);

  const updates = await mapLimit(pending, CONCURRENCY, async (m) => {
    try {
      const doc = applyCorrections(await withRetry(() => getDocText(m.docId!)), corrections);
      return { meetingId: m.id, transcript: extractSuggestions(m.id, doc, m.nextSteps) };
    } catch (error) {
      const code = (error as { code?: number; status?: number }).code ?? (error as { status?: number }).status;
      return code === 403 || code === 404 ? { meetingId: m.id, transcript: [] as TranscriptSuggestion[] } : null;
    }
  });
  return updates.filter((u) => u !== null);
}

export interface DiscoveryStats {
  scanned: number;
  skipped: number;
  matched: number;
  unmatched: number;
  failed: number;
}

export async function discoverGeminiMeetings(
  days: number,
  skipMessageIds: Set<string>,
): Promise<{ result: DiscoveryResult; stats: DiscoveryStats } | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;

  const gmail = google.gmail({ version: "v1", auth });
  const calendar = google.calendar({ version: "v3", auth });

  const profile = await withRetry(() => gmail.users.getProfile({ userId: "me" }));
  const ownerEmail = profile.data.emailAddress?.toLowerCase() ?? null;
  const ownDomain = ownerEmail?.split("@")[1] ?? "";
  const { corrections } = await getSettings();

  const [allIds, events] = await Promise.all([
    listGeminiMessageIds(gmail, days),
    listEvents(calendar, days),
  ]);
  const ids = allIds.filter((id) => !skipMessageIds.has(id));

  const byDocId = new Map<string, calendar_v3.Schema$Event>();
  const durationsByDocId: Record<string, number> = {};
  const attendeesByDocId: Record<string, MeetingAttendee[]> = {};
  const attendeesByEventKey: Record<string, MeetingAttendee[]> = {};
  for (const e of events) {
    const minutes = eventMinutes(e);
    const attendees = eventAttendees(e);
    if (attendees.length && e.summary) {
      attendeesByEventKey[eventKey(e.summary, new Date(eventStart(e)).toISOString())] = attendees;
    }
    for (const a of e.attachments ?? []) {
      if (!a.fileId) continue;
      byDocId.set(a.fileId, e);
      if (attendees.length) attendeesByDocId[a.fileId] = attendees;
      if (minutes != null) durationsByDocId[a.fileId] = minutes;
    }
  }

  const clients = new Map<string, DiscoveredClient>();
  const unmatched: DiscoveredMeeting[] = [];

  let failed = 0;
  await mapLimit(ids, CONCURRENCY, async (id) => {
    let msg: gmail_v1.Schema$Message;
    try {
      msg = (await withRetry(() => gmail.users.messages.get({ userId: "me", id, format: "full" }))).data;
    } catch {
      failed++; // no se persiste: se reintenta en el próximo escaneo
      return;
    }
    const subject = header(msg, "Subject");
    const title = titleFromSubject(subject) || subject;
    const mailTime = Number(msg.internalDate ?? Date.now());
    const { text, html } = extractBody(msg.payload ?? undefined);
    const body = text || stripHtml(html);
    const docId = (html + text).match(/docs\.google\.com\/document\/d\/([\w-]+)/)?.[1] ?? null;

    let event = docId ? byDocId.get(docId) : undefined;
    if (!event) {
      const norm = normalizeTitle(title);
      event = events
        .filter((e) => normalizeTitle(e.summary ?? "") === norm)
        .filter((e) => Math.abs(eventStart(e) - mailTime) <= DAY_MS)
        .sort((a, b) => Math.abs(eventStart(a) - mailTime) - Math.abs(eventStart(b) - mailTime))[0];
    }

    let notesText = body;
    let fromDoc = false;
    if (docId) {
      try {
        notesText = await withRetry(() => getDocText(docId));
        fromDoc = true;
      } catch {
        // Sin acceso al Doc (p. ej. creado por otro organizador): usamos el body del mail.
      }
    }
    notesText = applyCorrections(notesText, corrections);
    const parsed = parseGeminiNotes(notesText);
    const meeting: DiscoveredMeeting = {
      id,
      docId,
      title: event?.summary ?? title,
      date: new Date(event ? eventStart(event) : mailTime).toISOString(),
      summary: parsed.summary,
      nextSteps: parsed.nextSteps,
      milestones: parsed.milestones,
      decisions: parsed.decisions,
      transcript: fromDoc ? extractSuggestions(id, notesText, parsed.nextSteps) : [],
      durationMinutes: event ? eventMinutes(event) : null,
      attendees: event ? eventAttendees(event) : [],
    };

    const external = (event?.attendees ?? []).filter((a) => {
      const domain = a.email?.split("@")[1]?.toLowerCase();
      return domain && !a.resource && domain !== ownDomain && !IGNORED_DOMAINS.has(domain);
    });
    if (!external.length) {
      unmatched.push(meeting);
      return;
    }

    const seen = new Set<string>();
    for (const a of external) {
      const email = a.email!.toLowerCase();
      const domain = email.split("@")[1];
      const isFree = isFreemail(domain);
      const key = isFree ? email : domain;
      const client = clients.get(key) ?? {
        id: key,
        domain,
        name: isFree ? (a.displayName ?? email.split("@")[0]) : companyNameFromDomain(domain),
        contactEmails: [],
        meetings: [],
      };
      if (!client.contactEmails.includes(email)) client.contactEmails.push(email);
      if (!seen.has(key)) {
        client.meetings.push(meeting);
        seen.add(key);
      }
      clients.set(key, client);
    }
  });

  return {
    result: {
      clients: [...clients.values()],
      unmatched,
      durationsByDocId,
      attendeesByDocId,
      attendeesByEventKey,
      ownerEmail,
    },
    stats: {
      scanned: allIds.length,
      skipped: allIds.length - ids.length,
      matched: ids.length - unmatched.length - failed,
      unmatched: unmatched.length,
      failed,
    },
  };
}
