import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import type { TrackingStatus } from "@/types/account";
import type { MeetingDecision } from "@/lib/utils/gemini-notes-parser";

// Persistencia local (sin Supabase todavía) de clientes descubiertos desde Gemini Notes.
// Mismo patrón que google-token-store: archivo JSON en `.data/` (gitignored).

export type ClientStatus = "pending" | "assigned" | "unassigned" | "ignored";

export interface MeetingAttendee {
  email: string;
  name: string | null;
}

export interface DiscoveredMeeting {
  id: string; // id del mensaje de Gmail
  docId: string | null;
  title: string;
  date: string;
  summary: string | null;
  nextSteps: string[];
  durationMinutes?: number | null;
  /** Todos los asistentes del evento de Calendar (internos y externos, sin salas). */
  attendees?: MeetingAttendee[];
  /** Temas tratados, del Resumen de la minuta. `undefined` = minuta aún sin reprocesar. */
  milestones?: string[];
  decisions?: MeetingDecision[];
}

export interface ClientRecord {
  id: string; // dominio, o email si es freemail
  domain: string;
  name: string;
  status: ClientStatus;
  contactEmails: string[];
  meetings: DiscoveredMeeting[];
  trackingStatus: TrackingStatus | null;
  doneTicketIds?: string[];
  /** Fecha en que se marcó cada ticket como hecho (los previos a esta feature no tienen). */
  doneTicketAt?: Record<string, string>;
  /** Último cambio de cualquier ticket (invalida el borrador de seguimiento guardado). */
  ticketsUpdatedAt?: string;
  profile?: ClientProfile;
  /** Snapshot de la última sincronización Gmail/Calendar (`POST /api/clients/sync-activity`). */
  activity?: ClientActivity;
  /** Follow-ups editados / enviados a Gmail, por id de meeting. */
  followups?: Record<string, FollowupDraft>;
}

/** Mail real (no invitación, no auto-respuesta, no minuta) intercambiado con referentes. */
export interface MailRef {
  messageId: string;
  threadId: string;
  from: string;
  fromName: string | null;
  /** Destinatarios (To + Cc): a quién responder si el seguimiento parte de este mail. */
  recipients?: string[];
  subject: string;
  date: string;
  /** Texto propio del mail (sin citas), recortado. */
  excerpt: string;
  /** Tickets de la última reunión que este mail parece tratar (match por palabras clave). */
  relatedTicketIds: string[];
  /** Quién lo escribió: el cliente (referentes/invitados), un compañero del dominio propio, o yo. */
  direction?: MailDirection;
  /** Pedidos/preguntas detectados en mails del cliente (→ accionables de mi lado). */
  requests?: string[];
}

export type MailDirection = "client" | "team" | "me";

export interface ThreadRef {
  threadId: string;
  subject: string;
  date: string;
}

export interface ClientActivity {
  syncedAt: string;
  /** Último mail real de cualquier participante (cliente, equipo o yo). */
  lastMail?: MailRef | null;
  /** Mails reales más recientes en cualquier dirección (trazabilidad). */
  recentMails?: MailRef[];
  /** Último mail real del lado del cliente. */
  lastInboundMail: MailRef | null;
  /** Mails reales del lado del cliente dentro de `recentMails`. */
  recentInbound: MailRef[];
  /** Hilos recientes con referentes (cualquier dirección): destino del follow-up. */
  threads: ThreadRef[];
  /** Último evento de Calendar ya realizado con el cliente; `hasNotes` = tiene minuta. */
  lastCalendarMeeting: { title: string; date: string; hasNotes: boolean } | null;
  /** Mails descartados por tipo (invitaciones de Calendar, auto-respuestas, minutas). */
  skipped: { invitation: number; autoReply: number; minutes: number };
}

export interface FollowupDraft {
  meetingId: string;
  subject: string;
  body: string;
  to: string[];
  /** Referentes/equipo en copia: mail nuevo (todos) o resto del hilo al "Responder a todos". */
  cc?: string[];
  updatedAt: string;
  gmailDraftId?: string;
  gmailMessageId?: string;
  threadId?: string | null;
  draftCreatedAt?: string;
  /** Cuándo se envió desde la app; el próximo borrador se genera de cero con el estado actual. */
  sentAt?: string;
  /** Si lo generó el cron de seguimiento: fecha del último movimiento que lo disparó (dedupe). */
  autoFor?: string;
  /** Avisos para quien revisa el borrador: se muestran en la UI, nunca van en el mail. */
  reviewNotes?: string[];
}

export type FollowupKind = "meeting" | "status";
/** Clave en `client.followups`: follow-up de reunión = id de meeting; seguimiento = `status:<id>`. */
export const followupKey = (kind: FollowupKind, meetingId: string) =>
  kind === "status" ? `status:${meetingId}` : meetingId;

/** Tickets derivados del último mail del cliente: "-reply" y un ticket por pedido detectado. */
export const mailTicketId = (clientId: string, messageId: string, suffix: string | number) =>
  `${clientId}:mail-${messageId}-${suffix}`;

/** Ticket sintético "Enviar follow-up" de una reunión (se tilda como cualquier accionable). */
export const followupTicketId = (clientId: string, meetingId: string) =>
  `${clientId}:${meetingId}-followup`;

/** Datos editables a mano, pensados como contexto para el futuro agente LLM. */
export interface ClientProfile {
  /** Cómo se llama la empresa en los correos (razón social / nombre comercial). */
  emailName?: string;
  erp?: string;
  /** Owner de Xtract de la cuenta; si falta se usa `ClientsFile.ownerEmail`. */
  ownerEmail?: string;
  notes?: string;
  /** Override manual de la heurística de referentes: email → es referente. */
  referentOverrides?: Record<string, boolean>;
}

export interface ClientsFile {
  clients: ClientRecord[];
  unmatched: DiscoveredMeeting[];
  lastScanAt: string | null;
  /** Cuenta de Google que corrió el escaneo (= owner de Xtract por defecto). */
  ownerEmail?: string | null;
}

export interface DiscoveredClient {
  id: string;
  domain: string;
  name: string;
  contactEmails: string[];
  meetings: DiscoveredMeeting[];
}

export interface DiscoveryResult {
  clients: DiscoveredClient[];
  unmatched: DiscoveredMeeting[];
  /** Duración de cada evento con Doc adjunto, para backfill de meetings ya guardados. */
  durationsByDocId: Record<string, number>;
  /** Asistentes por Doc adjunto y por `título|fechaISO` del evento, para backfill. */
  attendeesByDocId: Record<string, MeetingAttendee[]>;
  attendeesByEventKey: Record<string, MeetingAttendee[]>;
  ownerEmail: string | null;
}

export const eventKey = (title: string, dateIso: string) => `${title}|${dateIso}`;

const DATA_DIR = path.join(process.cwd(), ".data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

const EMPTY: ClientsFile = { clients: [], unmatched: [], lastScanAt: null };

export async function getClientsFile(): Promise<ClientsFile> {
  let raw: string;
  try {
    raw = await readFile(CLIENTS_FILE, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY, clients: [], unmatched: [] };
    throw error;
  }
  // Un archivo corrupto NO equivale a vacío: tratarlo así haría que la próxima escritura borre los datos.
  try {
    return JSON.parse(raw) as ClientsFile;
  } catch (error) {
    throw new Error(`clients_file_corrupt: ${(error as Error).message}`);
  }
}

async function saveClientsFile(file: ClientsFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  // Escritura atómica: dos escrituras simultáneas no pueden mezclarse ni dejar el archivo a medias.
  const tmp = `${CLIENTS_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
    await rename(tmp, CLIENTS_FILE);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Ids de mensajes de Gmail ya procesados (para no re-exportar Docs al re-escanear). */
export function knownMeetingIds(file: ClientsFile): Set<string> {
  const ids = new Set<string>();
  for (const c of file.clients) for (const m of c.meetings) ids.add(m.id);
  for (const m of file.unmatched) ids.add(m.id);
  return ids;
}

function byDateDesc(a: DiscoveredMeeting, b: DiscoveredMeeting) {
  return b.date.localeCompare(a.date);
}

/** Merge no destructivo: preserva status/name/trackingStatus, agrega meetings nuevos por id. */
export async function mergeDiscovery(
  result: DiscoveryResult,
): Promise<{ file: ClientsFile; newClients: number }> {
  const file = await getClientsFile();
  let newClients = 0;

  for (const found of result.clients) {
    const existing = file.clients.find((c) => c.id === found.id);
    if (!existing) {
      file.clients.push({
        ...found,
        status: "pending",
        trackingStatus: null,
        meetings: [...found.meetings].sort(byDateDesc),
      });
      newClients++;
      continue;
    }
    const ids = new Set(existing.meetings.map((m) => m.id));
    existing.meetings = [
      ...existing.meetings,
      ...found.meetings.filter((m) => !ids.has(m.id)),
    ].sort(byDateDesc);
    existing.contactEmails = [...new Set([...existing.contactEmails, ...found.contactEmails])];
  }

  const matchedIds = new Set(file.clients.flatMap((c) => c.meetings.map((m) => m.id)));
  const unmatchedIds = new Set(file.unmatched.map((m) => m.id));
  file.unmatched = [
    ...file.unmatched,
    ...result.unmatched.filter((m) => !unmatchedIds.has(m.id)),
  ]
    .filter((m) => !matchedIds.has(m.id))
    .sort(byDateDesc);

  for (const m of [...file.clients.flatMap((c) => c.meetings), ...file.unmatched]) {
    if (m.durationMinutes == null && m.docId && result.durationsByDocId[m.docId] != null) {
      m.durationMinutes = result.durationsByDocId[m.docId];
    }
    if (!m.attendees?.length) {
      const found =
        (m.docId && result.attendeesByDocId[m.docId]) ||
        result.attendeesByEventKey[eventKey(m.title, m.date)];
      if (found?.length) m.attendees = found;
    }
  }

  if (result.ownerEmail) file.ownerEmail = result.ownerEmail;

  file.lastScanAt = new Date().toISOString();
  await saveClientsFile(file);
  return { file, newClients };
}

export async function updateClient(
  id: string,
  patch: Partial<Pick<ClientRecord, "status" | "name" | "trackingStatus">>,
): Promise<ClientRecord | null> {
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === id);
  if (!client) return null;
  Object.assign(client, patch);
  await saveClientsFile(file);
  return client;
}

export async function updateClientProfile(
  id: string,
  patch: Partial<ClientProfile>,
): Promise<ClientRecord | null> {
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === id);
  if (!client) return null;
  const profile = { ...client.profile };
  for (const [k, v] of Object.entries(patch) as [keyof ClientProfile, unknown][]) {
    if (k === "referentOverrides") {
      profile.referentOverrides = { ...profile.referentOverrides, ...(v as Record<string, boolean>) };
    } else if (typeof v === "string") {
      if (v.trim()) (profile[k] as string) = v.trim();
      else delete profile[k];
    }
  }
  client.profile = profile;
  await saveClientsFile(file);
  return client;
}

export async function setTicketDone(
  id: string,
  ticketId: string,
  isDone: boolean,
): Promise<ClientRecord | null> {
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === id);
  if (!client) return null;
  const done = new Set(client.doneTicketIds ?? []);
  const at = { ...client.doneTicketAt };
  const now = new Date().toISOString();
  if (isDone) {
    done.add(ticketId);
    at[ticketId] ??= now;
  } else {
    done.delete(ticketId);
    delete at[ticketId];
  }
  client.doneTicketIds = [...done];
  client.doneTicketAt = at;
  client.ticketsUpdatedAt = now;
  await saveClientsFile(file);
  return client;
}

export async function setClientActivity(
  updates: { id: string; activity: ClientActivity; autoDoneTicketIds: string[] }[],
): Promise<void> {
  const file = await getClientsFile();
  for (const u of updates) {
    const client = file.clients.find((c) => c.id === u.id);
    if (!client) continue;
    client.activity = u.activity;
    const already = new Set(client.doneTicketIds ?? []);
    const fresh = u.autoDoneTicketIds.filter((t) => !already.has(t));
    if (fresh.length) {
      const now = new Date().toISOString();
      client.doneTicketIds = [...already, ...fresh];
      client.doneTicketAt = { ...client.doneTicketAt, ...Object.fromEntries(fresh.map((t) => [t, now])) };
      client.ticketsUpdatedAt = now;
    }
  }
  await saveClientsFile(file);
}

/** Guarda hitos/decisiones de minutas reprocesadas (no toca `nextSteps`: los ids dependen del índice). */
export async function setMeetingNotes(
  updates: { meetingId: string; milestones: string[]; decisions: MeetingDecision[] }[],
): Promise<void> {
  if (!updates.length) return;
  const byId = new Map(updates.map((u) => [u.meetingId, u]));
  const file = await getClientsFile();
  for (const m of [...file.clients.flatMap((c) => c.meetings), ...file.unmatched]) {
    const u = byId.get(m.id);
    if (!u) continue;
    m.milestones = u.milestones;
    m.decisions = u.decisions;
  }
  await saveClientsFile(file);
}

export async function saveFollowup(
  id: string,
  key: string,
  draft: FollowupDraft,
): Promise<ClientRecord | null> {
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === id);
  if (!client) return null;
  client.followups = { ...client.followups, [key]: draft };
  await saveClientsFile(file);
  return client;
}
