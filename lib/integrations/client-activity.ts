import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "./google-client";
import { listEventsBetween } from "./calendar";
import { extractBody, mapLimit, stripHtml, withRetry } from "./gemini-mail";
import {
  followupTicketId,
  mailTicketId,
  type ClientActivity,
  type MailDirection,
  type ClientRecord,
  type MailRef,
  type ThreadRef,
} from "@/lib/store/clients-store";
import { computeParticipants } from "@/lib/utils/participants";
import { accountActionables } from "@/lib/utils/actionables";
import { classifyMail, extractCommitments, extractRequests, relatedActionables, stripQuoted } from "@/lib/utils/mail-classify";

// Sincroniza, por cliente, la última actividad real:
// - últimos mails REALES (sin invitaciones/respuestas de Calendar, auto-respuestas ni minutas) en
//   cualquier dirección: cliente (dominio, referentes e invitados externos), equipo (dominio propio)
//   o yo; con relación a los accionables de la última minuta y, si es del cliente, sus pedidos;
// - hilos recientes con referentes (destino del follow-up);
// - última reunión de Calendar ya realizada (detecta reuniones sin minuta);
// - auto-tildado: follow-up de reunión (mail mío posterior a la reunión) y "Responder" del último
//   mail del cliente (si hay un mail mío/del equipo posterior).

const GEMINI_SENDER = process.env.GEMINI_NOTES_SENDER ?? "gemini-notes@google.com";
const LOOKBACK_DAYS = 180;
const MAX_MAILS_CHECK = 30;
const KEEP_MAILS = 8;
const KEEP_THREADS = 5;
const CONCURRENCY = 2;
const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;

const hdr = (msg: gmail_v1.Schema$Message) =>
  Object.fromEntries(
    (msg.payload?.headers ?? []).map((h) => [h.name?.toLowerCase() ?? "", h.value ?? ""]),
  ) as Record<string, string>;

function parseFrom(from: string): { email: string; name: string | null } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m
    ? { email: m[2].toLowerCase(), name: m[1].trim() || null }
    : { email: from.trim().toLowerCase(), name: null };
}

const parseAddresses = (value: string) => [
  ...new Set((value.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((e) => e.toLowerCase())),
];

function hasCalendarPart(part?: gmail_v1.Schema$MessagePart): boolean {
  if (!part) return false;
  if (part.mimeType === "text/calendar" || part.mimeType === "application/ics") return true;
  if (/\.ics$/i.test(part.filename ?? "")) return true;
  return (part.parts ?? []).some(hasCalendarPart);
}

/** Targets de búsqueda Gmail: dominio (si no es freemail) + emails de referentes de otro dominio. */
function clientTargets(client: ClientRecord, ownerEmail: string | null, shared: Set<string>) {
  // Referentes + invitados externos exclusivos de esta cuenta (consultores, partners). Se excluyen
  // externos que aparecen en otras cuentas o que son otro cliente (evita mezclar cuentas).
  const referents = computeParticipants(client, ownerEmail)
    .filter((p) => p.role === "referent" || (p.role === "external" && !shared.has(p.email)))
    .map((p) => p.email);
  const domain = FREEMAIL.test(client.domain) ? null : client.domain;
  // Cliente de dominio propio: dominio + referentes (incl. overrides de otro dominio).
  // Cliente freemail (id = email): sus contactos directos.
  const emails = [
    ...new Set([...referents, ...(domain ? [] : client.contactEmails.map((e) => e.toLowerCase()))]),
  ];
  const extra = domain ? emails.filter((e) => !e.endsWith(`@${domain}`)) : emails;
  const query = [...(domain ? [`@${domain}`] : []), ...extra];
  const matches = (email: string) =>
    (domain != null && email.endsWith(`@${domain}`)) || emails.includes(email);
  return { query, matches };
}

async function syncOne(
  gmail: gmail_v1.Gmail,
  client: ClientRecord,
  ownerEmail: string | null,
  events: Awaited<ReturnType<typeof listEventsBetween>>,
  shared: Set<string>,
): Promise<{ activity: ClientActivity; autoDoneTicketIds: string[] }> {
  const { query, matches } = clientTargets(client, ownerEmail, shared);
  const or = query.join(" OR ");
  const latest = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
  const acts = accountActionables(client);
  const skipped = { invitation: 0, autoReply: 0, minutes: 0 };
  const recentMails: MailRef[] = [];
  const threads: ThreadRef[] = [];
  const autoDoneTicketIds: string[] = [];

  if (query.length) {
    // 1) Mails reales con el cliente en cualquier dirección (de/para/cc cualquier participante):
    //    del más nuevo al más viejo hasta juntar KEEP_MAILS reales (y al menos uno del cliente).
    const me = ownerEmail?.toLowerCase() ?? null;
    const ownDomain = me?.split("@")[1] ?? "";
    const direction = (email: string): MailDirection =>
      email === me ? "me" : ownDomain && !FREEMAIL.test(ownDomain) && email.endsWith(`@${ownDomain}`) ? "team" : "client";
    const list = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        q: `{from:(${or}) to:(${or}) cc:(${or})} -from:${GEMINI_SENDER} -from:calendar-notification@google.com -in:drafts newer_than:${LOOKBACK_DAYS}d`,
        maxResults: MAX_MAILS_CHECK,
      }),
    );
    for (const { id } of list.data.messages ?? []) {
      const hasClient = recentMails.some((m) => m.direction === "client");
      if (recentMails.length >= KEEP_MAILS && hasClient) break;
      if (recentMails.length >= KEEP_MAILS * 2) break;
      const msg = (await withRetry(() => gmail.users.messages.get({ userId: "me", id: id!, format: "full" }))).data;
      if (msg.labelIds?.includes("DRAFT")) continue; // un borrador no es un mail: nadie lo recibió
      const h = hdr(msg);
      const from = parseFrom(h["from"] ?? "");
      const dir = direction(from.email);
      // Del lado cliente solo cuentan remitentes reconocidos (evita terceros que nos copian).
      if (dir === "client" && !matches(from.email)) continue;
      const kind = classifyMail({
        subject: h["subject"] ?? "",
        from: from.email,
        headers: h,
        hasCalendarPart: hasCalendarPart(msg.payload ?? undefined),
      });
      if (kind !== "message") {
        skipped[kind]++;
        continue;
      }
      // Pasado el cupo solo seguimos buscando el último mail del cliente.
      if (recentMails.length >= KEEP_MAILS && dir !== "client") continue;
      const { text, html } = extractBody(msg.payload ?? undefined);
      const own = stripQuoted(text || stripHtml(html));
      const subject = h["subject"] ?? "(sin asunto)";
      const related = relatedActionables(`${subject}\n${own}`, acts.map((x) => x.step)).map((i) => acts[i].id);
      recentMails.push({
        messageId: msg.id!,
        threadId: msg.threadId!,
        from: from.email,
        fromName: from.name,
        recipients: parseAddresses(`${h["to"] ?? ""},${h["cc"] ?? ""}`),
        subject,
        date: new Date(Number(msg.internalDate)).toISOString(),
        excerpt: (own || msg.snippet || "").slice(0, 1200),
        relatedTicketIds: related,
        direction: dir,
        ...(dir === "client" ? { requests: extractRequests(own) } : {}),
        ...(dir === "me" ? { commitments: extractCommitments(own) } : {}),
      });
    }
    recentMails.sort((a, b) => b.date.localeCompare(a.date));

    // Último mail del cliente ya respondido (mío o del equipo, posterior) → ticket "Responder" hecho.
    const lastClient = recentMails.find((m) => m.direction === "client");
    if (lastClient && recentMails.some((m) => m.direction !== "client" && m.date > lastClient.date)) {
      autoDoneTicketIds.push(mailTicketId(client.id, lastClient.messageId, "reply"));
    }

    // 2) Hilos recientes con referentes (cualquier dirección), sin minutas ni invitaciones.
    const tl = await withRetry(() =>
      gmail.users.threads.list({
        userId: "me",
        q: `{from:(${or}) to:(${or}) cc:(${or})} -from:${GEMINI_SENDER} -from:calendar-notification@google.com -in:drafts newer_than:${LOOKBACK_DAYS}d`,
        maxResults: KEEP_THREADS * 2,
      }),
    );
    for (const t of tl.data.threads ?? []) {
      if (threads.length >= KEEP_THREADS) break;
      const th = (
        await withRetry(() =>
          gmail.users.threads.get({
            userId: "me",
            id: t.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Auto-Submitted"],
          }),
        )
      ).data;
      const msgs = th.messages ?? [];
      const real = msgs.filter((m) => {
        if (m.labelIds?.includes("DRAFT")) return false;
        const h = hdr(m);
        return (
          classifyMail({ subject: h["subject"] ?? "", from: h["from"] ?? "", headers: h, hasCalendarPart: false }) ===
          "message"
        );
      });
      // Solo hilos donde participa un referente o yo (descarta reportes automáticos de terceros).
      const involved = real.some((m) => {
        const from = parseFrom(hdr(m)["from"] ?? "").email;
        return matches(from) || from === me;
      });
      if (!real.length || !involved) continue;
      const last = real.at(-1)!;
      threads.push({
        threadId: t.id!,
        subject: hdr(msgs[0])["subject"] || "(sin asunto)",
        date: new Date(Number(last.internalDate)).toISOString(),
      });
    }

    // 3) ¿Ya mandé follow-up? Mail mío a referentes posterior a la última reunión.
    if (latest) {
      const after = Math.floor(new Date(latest.date).getTime() / 1000);
      const sent = await withRetry(() =>
        gmail.users.messages.list({
          userId: "me",
          q: `from:me {to:(${or}) cc:(${or})} -in:drafts after:${after}`,
          maxResults: 5,
        }),
      );
      for (const { id } of sent.data.messages ?? []) {
        const m = (
          await withRetry(() =>
            gmail.users.messages.get({ userId: "me", id: id!, format: "metadata", metadataHeaders: ["Subject"] }),
          )
        ).data;
        const h = hdr(m);
        if (m.labelIds?.includes("DRAFT")) continue;
        if (classifyMail({ subject: h["subject"] ?? "", from: "", headers: h, hasCalendarPart: false }) === "message") {
          autoDoneTicketIds.push(followupTicketId(client.id, latest.id));
          break;
        }
      }
    }
  }

  // 4) Última reunión de Calendar ya realizada con algún referente / dominio del cliente.
  const now = Date.now();
  const lastEvent = (events ?? [])
    .filter((e) => Date.parse(e.end) <= now && e.attendees.some(matches))
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const lastCalendarMeeting = lastEvent
    ? {
        title: lastEvent.title,
        date: new Date(lastEvent.start).toISOString(),
        hasNotes: client.meetings.some(
          (m) => Math.abs(Date.parse(m.date) - Date.parse(lastEvent.start)) <= 12 * 3_600_000,
        ),
      }
    : null;

  return {
    activity: {
      syncedAt: new Date().toISOString(),
      lastMail: recentMails[0] ?? null,
      recentMails,
      lastInboundMail: recentMails.find((m) => m.direction === "client") ?? null,
      recentInbound: recentMails.filter((m) => m.direction === "client"),
      threads,
      lastCalendarMeeting,
      skipped,
    },
    autoDoneTicketIds,
  };
}

/** Emails externos presentes en reuniones de ≥2 clientes, o que son el id/contacto de otro cliente. */
function sharedExternals(all: ClientRecord[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  const add = (email: string, id: string) => {
    const set = seen.get(email) ?? new Set<string>();
    set.add(id);
    seen.set(email, set);
  };
  for (const c of all) {
    for (const m of c.meetings) for (const a of m.attendees ?? []) add(a.email.toLowerCase(), c.id);
    for (const e of c.contactEmails) add(e.toLowerCase(), c.id);
    if (c.id.includes("@")) add(c.id.toLowerCase(), `self:${c.id}`);
  }
  return new Set([...seen].filter(([, ids]) => ids.size > 1).map(([email]) => email));
}

export async function syncClientsActivity(
  clients: ClientRecord[],
  ownerEmail: string | null,
  allClients: ClientRecord[] = clients,
): Promise<{ id: string; activity: ClientActivity; autoDoneTicketIds: string[]; error?: string }[] | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth });
  const events = await listEventsBetween(new Date(Date.now() - 90 * 86_400_000), new Date());
  const shared = sharedExternals(allClients);

  return mapLimit(clients, CONCURRENCY, async (client) => {
    try {
      return { id: client.id, ...(await syncOne(gmail, client, ownerEmail, events, shared)) };
    } catch (error) {
      // Conserva el snapshot previo si falla (rate limit, etc.).
      return {
        id: client.id,
        activity: client.activity!,
        autoDoneTicketIds: [],
        error: (error as Error).message,
      };
    }
  });
}
