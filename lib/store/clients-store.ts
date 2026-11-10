import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { DATA_DIR, getState, setState, usingSupabase } from "@/lib/store/backend";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MeetingDecision } from "@/lib/utils/gemini-notes-parser";
import { collectMailItems, mailTicketId, type MailItem } from "@/lib/utils/mail-items";

export { mailTicketId };

// Clientes descubiertos desde Gemini Notes. Persistencia: ver "Persistencia" más abajo.

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

export interface CustomActionable {
  id: string;
  title: string;
  /** Reunión a la que queda asociado (para fechas y arrastre). */
  meetingId: string;
  createdAt: string;
}

export interface ClientRecord {
  id: string; // dominio, o email si es freemail
  domain: string;
  name: string;
  status: ClientStatus;
  contactEmails: string[];
  meetings: DiscoveredMeeting[];
  /** @deprecated Legado del Tablero Seguimiento (eliminado): se conserva solo para no perder datos guardados. */
  trackingStatus: string | null;
  doneTicketIds?: string[];
  /** Fecha en que se marcó cada ticket como hecho (los previos a esta feature no tienen). */
  doneTicketAt?: Record<string, string>;
  /** Último cambio de cualquier ticket (invalida el borrador de seguimiento guardado). */
  ticketsUpdatedAt?: string;
  /** Último cambio en cómo se nombra a la cuenta o sus contactos (invalida el borrador guardado). */
  profileUpdatedAt?: string;
  /** Texto corregido a mano de un accionable: ticket → texto. */
  actionableEdits?: Record<string, string>;
  /** Accionables creados a mano; cuentan igual que los de la minuta (Cuentas, Capacidad y mails). */
  customActionables?: CustomActionable[];
  /** Accionables detectados que quité porque no correspondían. */
  removedTicketIds?: string[];
  /** Pedidos y compromisos detectados en mails: siguen aunque el mail salga de `activity.recentMails`. */
  mailActionables?: Record<string, MailItem>;
  /** @deprecated Legado del Tablero Seguimiento (eliminado): cards ubicadas a mano. Solo se conserva el dato. */
  boardOverrides?: Record<string, { status: string; at: string }>;
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
  /** Compromisos detectados en mails míos (→ accionables de mi lado). */
  commitments?: string[];
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
  /** Cómo saludar a cada contacto en los mails: email → nombre (se usa tal cual). */
  contactNames?: Record<string, string>;
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

const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

const EMPTY: ClientsFile = { clients: [], unmatched: [], lastScanAt: null };

// Persistencia: Supabase (una fila por cliente en `clients`, más `app_state.clients_meta` y
// `clients_unmatched`) o, en modo local, `.data/clients.json`. Ver `lib/store/backend.ts`.

interface ClientsMeta {
  lastScanAt: string | null;
  ownerEmail?: string | null;
}

interface ClientRow {
  id: string;
  data: ClientRecord;
  version: number;
}

async function readLocalFile(): Promise<ClientsFile> {
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

/** Columnas de la fila (las sueltas son para filtrar/ver en el panel; la verdad es `data`). */
export function clientRow(c: ClientRecord) {
  return { id: c.id, status: c.status, name: c.name, domain: c.domain, data: c };
}

async function fetchRows(ids?: string[]): Promise<ClientRow[]> {
  let query = supabaseAdmin().from("clients").select("id, data, version").order("seq");
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw new Error(`clients_read: ${error.message}`);
  return (data ?? []) as ClientRow[];
}

export async function getClientsFile(): Promise<ClientsFile> {
  if (!usingSupabase()) return readLocalFile();
  const [rows, meta, unmatched] = await Promise.all([
    fetchRows(),
    getState<ClientsMeta>("clients_meta"),
    getState<DiscoveredMeeting[]>("clients_unmatched"),
  ]);
  return {
    clients: rows.map((r) => r.data),
    unmatched: unmatched ?? [],
    lastScanAt: meta?.lastScanAt ?? null,
    ownerEmail: meta?.ownerEmail ?? null,
  };
}

/** Una sola cuenta + `ownerEmail`, sin traer el resto de las filas (vista de detalle). */
export async function getClient(id: string): Promise<{ client: ClientRecord | null; ownerEmail: string | null }> {
  if (!usingSupabase()) {
    const file = await readLocalFile();
    return { client: file.clients.find((c) => c.id === id) ?? null, ownerEmail: file.ownerEmail ?? null };
  }
  const [rows, meta] = await Promise.all([fetchRows([id]), getState<ClientsMeta>("clients_meta")]);
  return { client: rows[0]?.data ?? null, ownerEmail: meta?.ownerEmail ?? null };
}

/** Devolverlo desde un mutador = no hubo cambios, no se escribe. */
const SKIP: unique symbol = Symbol("skip");
type Mutator<R> = (client: ClientRecord) => R | typeof SKIP;
type Mutated<R> = { client: ClientRecord; result: R };

/** Escribe una fila solo si nadie la cambió desde que se leyó; si no, relee y reaplica `fn`. */
async function applyToRow<R>(row: ClientRow, fn: Mutator<R>, attempt = 0): Promise<Mutated<R> | null> {
  const client = row.data;
  const result = fn(client);
  if (result === SKIP) return null;
  const { data, error } = await supabaseAdmin()
    .from("clients")
    .update({ ...clientRow(client), version: row.version + 1 })
    .eq("id", row.id)
    .eq("version", row.version)
    .select("id");
  if (error) throw new Error(`clients_write(${row.id}): ${error.message}`);
  if (data?.length) return { client, result };
  if (attempt >= 4) throw new Error(`clients_write_conflict(${row.id})`);
  const [fresh] = await fetchRows([row.id]);
  return fresh ? applyToRow(fresh, fn, attempt + 1) : null;
}

/** Aplica `fn` a los clientes `ids` (o a todos con `null`) y persiste solo los que cambiaron. */
async function mutateClients<R>(ids: string[] | null, fn: Mutator<R>): Promise<Map<string, Mutated<R>>> {
  const out = new Map<string, Mutated<R>>();
  if (!usingSupabase()) {
    const file = await readLocalFile();
    const wanted = ids && new Set(ids);
    for (const client of file.clients) {
      if (wanted && !wanted.has(client.id)) continue;
      const result = fn(client);
      if (result !== SKIP) out.set(client.id, { client, result });
    }
    if (out.size) await saveClientsFile(file);
    return out;
  }
  const rows = await fetchRows(ids ?? undefined);
  for (let i = 0; i < rows.length; i += 8) {
    const done = await Promise.all(rows.slice(i, i + 8).map((row) => applyToRow(row, fn)));
    for (const m of done) if (m) out.set(m.client.id, m);
  }
  return out;
}

async function mutateClient<R>(id: string, fn: Mutator<R>): Promise<Mutated<R> | null> {
  return (await mutateClients([id], fn)).get(id) ?? null;
}

/** Aplica `fn` a los campos de nivel archivo (clientes nuevos, sin cliente, meta), sin tocar los existentes. */
async function mutateFileLevel(fn: (state: { added: ClientRecord[]; unmatched: DiscoveredMeeting[]; meta: ClientsMeta }) => void): Promise<void> {
  if (!usingSupabase()) {
    const file = await readLocalFile();
    const known = new Set(file.clients.map((c) => c.id));
    const state = { added: [] as ClientRecord[], unmatched: file.unmatched, meta: { lastScanAt: file.lastScanAt, ownerEmail: file.ownerEmail } };
    fn(state);
    file.clients.push(...state.added.filter((c) => !known.has(c.id)));
    file.unmatched = state.unmatched;
    file.lastScanAt = state.meta.lastScanAt;
    file.ownerEmail = state.meta.ownerEmail;
    await saveClientsFile(file);
    return;
  }
  const [meta, unmatched] = await Promise.all([
    getState<ClientsMeta>("clients_meta"),
    getState<DiscoveredMeeting[]>("clients_unmatched"),
  ]);
  const state = { added: [] as ClientRecord[], unmatched: unmatched ?? [], meta: meta ?? { lastScanAt: null } };
  fn(state);
  if (state.added.length) {
    const { error } = await supabaseAdmin()
      .from("clients")
      .upsert(state.added.map(clientRow), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`clients_insert: ${error.message}`);
  }
  await Promise.all([setState("clients_unmatched", state.unmatched), setState("clients_meta", state.meta)]);
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

function backfillMeetings(meetings: DiscoveredMeeting[], result: DiscoveryResult): void {
  for (const m of meetings) {
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
}

/** Merge no destructivo: preserva status/name, agrega meetings nuevos por id. */
export async function mergeDiscovery(
  result: DiscoveryResult,
): Promise<{ file: ClientsFile; newClients: number }> {
  const before = await getClientsFile();
  const known = new Set(before.clients.map((c) => c.id));
  const foundById = new Map(result.clients.map((c) => [c.id, c]));

  // Clientes existentes: meetings nuevos, emails nuevos y backfill de duración/asistentes.
  await mutateClients(null, (existing) => {
    const snapshot = JSON.stringify(existing);
    const found = foundById.get(existing.id);
    if (found) {
      const ids = new Set(existing.meetings.map((m) => m.id));
      existing.meetings = [
        ...existing.meetings,
        ...found.meetings.filter((m) => !ids.has(m.id)),
      ].sort(byDateDesc);
      existing.contactEmails = [...new Set([...existing.contactEmails, ...found.contactEmails])];
    }
    backfillMeetings(existing.meetings, result);
    return JSON.stringify(existing) === snapshot ? SKIP : true;
  });

  const added: ClientRecord[] = result.clients
    .filter((found) => !known.has(found.id))
    .map((found) => ({
      ...found,
      status: "pending",
      trackingStatus: null,
      meetings: [...found.meetings].sort(byDateDesc),
    }));
  for (const c of added) backfillMeetings(c.meetings, result);

  const matchedIds = new Set([
    ...before.clients.flatMap((c) => c.meetings.map((m) => m.id)),
    ...result.clients.flatMap((c) => c.meetings.map((m) => m.id)),
  ]);
  await mutateFileLevel((state) => {
    state.added = added;
    const unmatchedIds = new Set(state.unmatched.map((m) => m.id));
    state.unmatched = [
      ...state.unmatched,
      ...result.unmatched.filter((m) => !unmatchedIds.has(m.id)),
    ]
      .filter((m) => !matchedIds.has(m.id))
      .sort(byDateDesc);
    backfillMeetings(state.unmatched, result);
    if (result.ownerEmail) state.meta.ownerEmail = result.ownerEmail;
    state.meta.lastScanAt = new Date().toISOString();
  });

  return { file: await getClientsFile(), newClients: added.length };
}

export async function updateClient(
  id: string,
  patch: Partial<Pick<ClientRecord, "status" | "name">>,
): Promise<ClientRecord | null> {
  const m = await mutateClient(id, (client) => {
    Object.assign(client, patch);
  });
  return m?.client ?? null;
}

export async function updateClientProfile(
  id: string,
  patch: Partial<ClientProfile>,
): Promise<ClientRecord | null> {
  const m = await mutateClient(id, (client) => {
    const profile = { ...client.profile };
    const naming = (p: ClientProfile) => JSON.stringify([p.emailName ?? "", p.contactNames ?? {}]);
    const namingBefore = naming(profile);
    for (const [k, v] of Object.entries(patch) as [keyof ClientProfile, unknown][]) {
      if (k === "referentOverrides") {
        profile.referentOverrides = { ...profile.referentOverrides, ...(v as Record<string, boolean>) };
      } else if (k === "contactNames") {
        const names = { ...profile.contactNames };
        for (const [email, name] of Object.entries(v as Record<string, string>)) {
          if (name.trim()) names[email] = name.trim();
          else delete names[email];
        }
        profile.contactNames = names;
      } else if (typeof v === "string") {
        if (v.trim()) (profile[k] as string) = v.trim();
        else delete profile[k];
      }
    }
    client.profile = profile;
    if (naming(profile) !== namingBefore) client.profileUpdatedAt = new Date().toISOString();
  });
  return m?.client ?? null;
}

export type ActionableChange =
  | { op: "add"; title: string }
  | { op: "edit"; id: string; title: string }
  | { op: "remove"; id: string };

/** Crear, corregir o quitar un accionable. Toca `ticketsUpdatedAt`: los borradores se regeneran con el cambio. */
export async function changeActionable(id: string, change: ActionableChange): Promise<{ client: ClientRecord; ticketId: string } | null> {
  const m = await mutateClient(id, (client): string | typeof SKIP => {
    const now = new Date().toISOString();
    let ticketId: string;
    if (change.op === "add") {
      const latest = client.meetings.reduce<DiscoveredMeeting | null>((max, m) => (!max || m.date > max.date ? m : max), null);
      if (!latest) return SKIP;
      ticketId = `${client.id}:custom-${randomUUID().slice(0, 8)}`;
      client.customActionables = [
        ...(client.customActionables ?? []),
        {
          id: ticketId,
          title: change.title,
          meetingId: latest.id,
          createdAt: now,
        },
      ];
    } else if (change.op === "edit") {
      ticketId = change.id;
      client.actionableEdits = { ...client.actionableEdits, [change.id]: change.title };
    } else {
      ticketId = change.id;
      if (client.customActionables?.some((c) => c.id === change.id)) {
        client.customActionables = client.customActionables.filter((c) => c.id !== change.id);
      } else {
        client.removedTicketIds = [...new Set([...(client.removedTicketIds ?? []), change.id])];
      }
      if (client.actionableEdits) delete client.actionableEdits[change.id];
      client.doneTicketIds = (client.doneTicketIds ?? []).filter((t) => t !== change.id);
      if (client.doneTicketAt) delete client.doneTicketAt[change.id];
    }
    client.ticketsUpdatedAt = now;
    return ticketId;
  });
  return m ? { client: m.client, ticketId: m.result } : null;
}

export async function setTicketDone(
  id: string,
  ticketId: string,
  isDone: boolean,
): Promise<ClientRecord | null> {
  const m = await mutateClient(id, (client) => {
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
  });
  return m?.client ?? null;
}

export async function setClientActivity(
  updates: { id: string; activity: ClientActivity; autoDoneTicketIds: string[] }[],
): Promise<void> {
  const byId = new Map(updates.map((u) => [u.id, u]));
  await mutateClients([...byId.keys()], (client) => {
    const u = byId.get(client.id)!;
    client.activity = u.activity;
    client.mailActionables = collectMailItems(client);
    const already = new Set(client.doneTicketIds ?? []);
    const fresh = u.autoDoneTicketIds.filter((t) => !already.has(t));
    if (fresh.length) {
      const now = new Date().toISOString();
      client.doneTicketIds = [...already, ...fresh];
      client.doneTicketAt = { ...client.doneTicketAt, ...Object.fromEntries(fresh.map((t) => [t, now])) };
      client.ticketsUpdatedAt = now;
    }
  });
}

/** Guarda hitos/decisiones de minutas reprocesadas (no toca `nextSteps`: los ids dependen del índice). */
export async function setMeetingNotes(
  updates: { meetingId: string; milestones: string[]; decisions: MeetingDecision[] }[],
): Promise<void> {
  if (!updates.length) return;
  const byId = new Map(updates.map((u) => [u.meetingId, u]));
  const apply = (meetings: DiscoveredMeeting[]): boolean => {
    let changed = false;
    for (const m of meetings) {
      const u = byId.get(m.id);
      if (!u) continue;
      m.milestones = u.milestones;
      m.decisions = u.decisions;
      changed = true;
    }
    return changed;
  };
  await mutateClients(null, (client) => (apply(client.meetings) ? true : SKIP));
  await mutateFileLevel((state) => void apply(state.unmatched));
}

export async function saveFollowup(
  id: string,
  key: string,
  draft: FollowupDraft,
): Promise<ClientRecord | null> {
  const m = await mutateClient(id, (client) => {
    client.followups = { ...client.followups, [key]: draft };
  });
  return m?.client ?? null;
}
