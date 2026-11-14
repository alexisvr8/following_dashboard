import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { DATA_DIR, getState, setState, usingSupabase } from "@/lib/store/backend";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MeetingDecision } from "@/lib/utils/gemini-notes-parser";
import { applyCorrections, type TranscriptSuggestion } from "@/lib/utils/transcript";
import type { Correction } from "@/lib/store/settings-store";
import { collectMailItems, mailTicketId, type MailItem } from "@/lib/utils/mail-items";
import type { AISide, AIStatus, PostMeetingOutput } from "@/lib/llm/postmeeting-schema";
import type { AccountAnalysisOutput, Level } from "@/lib/llm/account-analysis-schema";
import { keywordSimilarity } from "@/lib/utils/mail-classify";
import { accountActionables, stepTicketId } from "@/lib/utils/actionables";

export { mailTicketId };

// Clientes descubiertos desde Gemini Notes. Persistencia: ver "Persistencia" más abajo.

export type ClientStatus = "pending" | "assigned" | "unassigned" | "ignored";

export interface MeetingAttendee {
  email: string;
  name: string | null;
}

export interface MeetingSpeaker {
  name: string;
  turns: number;
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
  /** Compromisos/pedidos de la transcripción. `undefined` = aún sin procesar. */
  transcript?: TranscriptSuggestion[];
  /** Quiénes hablaron en la transcripción (nombre tal como lo pone Gemini) y cuántos turnos. `undefined` = sin procesar. */
  speakers?: MeetingSpeaker[];
  /** Mail post-reunión generado por Claude (`lib/integrations/meeting-ai.ts`); sus accionables = `nextSteps`. */
  ai?: MeetingAI;
  /** Intentos fallidos de generación (se deja de intentar en `AI_MAX_ATTEMPTS`). */
  aiAttempts?: number;
  aiError?: string;
}

export interface MeetingAIStep {
  status: AIStatus | "Hecho";
  empresa: AISide;
  requiereRevision?: boolean;
  /** Versión corta para el mail ("Título: resumen"); la card usa el detalle completo de `nextSteps`. */
  mail?: string;
}

export interface MeetingAI {
  model: string;
  generatedAt: string;
  objetivo: string;
  puntos: string[];
  charlamos: string[];
  /** Por índice de `nextSteps` (accionables y, al final, lo ya avanzado). */
  steps: MeetingAIStep[];
  revision: string[];
  /** `nextSteps` originales de Gemini, antes de reemplazarlos por los de la IA. */
  geminiNextSteps: string[];
  /**
   * Solo contexto (objetivo / puntos / charlamos / revisión): la reunión ya tenía accionables tocados, así que
   * `nextSteps` no se reemplazó (los ids dependen del índice) y `steps` queda vacío (status/lado por reglas).
   */
  contextOnly?: true;
}

export interface CustomActionable {
  id: string;
  title: string;
  /** Reunión a la que queda asociado (para fechas y arrastre). */
  meetingId: string;
  createdAt: string;
  /** "ia" = lo agregó el análisis semanal (`setAccountAnalysis`); sin valor = a mano o sugerencia aceptada. */
  source?: "ia";
  /** De dónde lo sacó la IA ("Mail de Facundo 12/11: «Accesos»"). */
  evidence?: string;
}

export interface StatusAI {
  meetingId: string;
  /** Huella de la entrada (`statusKey`): si cambió lo tildado o llegó un mail, deja de aplicarse. */
  key: string;
  generatedAt: string;
  model: string;
  apertura: string;
  /** Ref del punto ("H1", "N2"…) → texto redactado. */
  items: Record<string, string>;
  cierre: string;
  revision: string[];
  error?: string;
}

/** Análisis semanal de la cuenta con IA (`lib/integrations/account-analysis.ts`). */
export interface AccountAnalysis {
  /** Lunes de la semana analizada (AAAA-MM-DD). */
  week: string;
  generatedAt: string;
  model: string;
  basis: "reunion" | "mails";
  /** Desde cuándo se leyeron los mails (ISO). */
  since: string;
  threadsRead: number;
  mailsRead: number;
  /** Quedaron hilos afuera por el tope de texto. */
  truncated?: boolean;
  /** Ref del prompt ("A3") → id del ticket. */
  refs: Record<string, string>;
  output: AccountAnalysisOutput;
  /** Accionables nuevos que el análisis agregó al tablero. */
  addedTicketIds: string[];
  /** Texto de cada ref al analizar: una reescritura solo se ofrece si el accionable no cambió desde entonces. */
  refTexts?: Record<string, string>;
  /** Reescrituras ya resueltas en el modal "Mejoras IA" (por ref). */
  rewritesResolved?: Record<string, "accepted" | "dismissed">;
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
  /** Fecha de entrega puesta a mano (AAAA-MM-DD): manda sobre la detectada en la minuta y la meta interna. */
  actionableDue?: Record<string, string>;
  /** Minutos estimados puestos a mano (si falta, `settings.hoursPerActionable`). */
  actionableEstimate?: Record<string, number>;
  /** Lado corregido a mano (manda sobre el detectado). */
  actionableSide?: Record<string, "debo" | "me_deben">;
  /** Sugerencias de la transcripción ya resueltas (aceptada → accionable propio; descartada → enseña). */
  suggestions?: Record<string, { state: "accepted" | "dismissed"; at: string; text: string; ticketId?: string }>;
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
  /** Último análisis semanal con IA. */
  analysis?: AccountAnalysis;
  /** Último error del análisis (se reintenta en la próxima corrida). */
  analysisError?: { at: string; message: string };
  /** Textos que la IA ya agregó alguna vez (aunque después se quitaron): no se vuelven a agregar. */
  aiLearned?: string[];
  /** Minutos estimados por la IA (minuta post-reunión o análisis semanal) por ticket; la estimación manual manda. */
  aiEstimate?: Record<string, number>;
  /** Redacción con IA del mail de seguimiento vigente (`lib/integrations/status-ai.ts`); vale mientras `key` coincida. */
  statusAI?: StatusAI;
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
  /** Hilo de seguimiento fijado de la cuenta (`profile.followupThread`). */
  pinned?: boolean;
}

/** Estado en Gmail del hilo fijado (lo revisa cada sync): si se borró o llegó al tope de Gmail, no se usa. */
export interface PinnedThreadStatus {
  threadId: string;
  /** Mensajes reales del hilo (Gmail no agrega más de 100 a un hilo). */
  messages: number;
  /** Fecha del último mensaje. */
  date: string | null;
  missing?: boolean;
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
  /** Estado del hilo fijado (`profile.followupThread`), si la cuenta tiene uno. */
  pinnedThread?: PinnedThreadStatus | null;
  /** Último evento de Calendar ya realizado con el cliente; `hasNotes` = tiene minuta. */
  lastCalendarMeeting: { title: string; date: string; hasNotes: boolean } | null;
  /** Mails descartados por tipo (invitaciones de Calendar, auto-respuestas, minutas). */
  skipped: { invitation: number; autoReply: number; minutes: number; automation?: number };
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
  /** Texto que quedó en el borrador de Gmail (para avisar cuando hay avances que todavía no tiene). */
  gmailBody?: string;
  /** Cuándo se envió desde la app; el próximo borrador se genera de cero con el estado actual. */
  sentAt?: string;
  /** Si lo generó el cron de seguimiento: fecha del último movimiento que lo disparó (dedupe). */
  autoFor?: string;
  /** Avisos para quien revisa el borrador: se muestran en la UI, nunca van en el mail. */
  reviewNotes?: string[];
  /** Por qué se eligió el hilo (`pickFollowupThread`): fijado / asunto estándar / último con el cliente / nuevo. */
  threadReason?: "pinned" | "standard" | "recent" | "new" | "anchor";
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
  /** Hilo de seguimiento fijado (⭐ en el composer): los borradores post-reunión van siempre acá. */
  followupThread?: { threadId: string; subject: string; pinnedAt: string };
  /** Prioridad marcada a mano (manda sobre la sugerida por la IA en `analysis.output.prioridad`). */
  priority?: Level;
  /**
   * "Más atención" (cliente exigente): sus accionables van siempre en prioridad alta y con meta interna de
   * `settings.attentionTargetDays` (1) día hábil, alerta de seguimiento al 1er día hábil sin novedades y la IA lo sabe.
   */
  attention?: boolean;
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
      } else if (k === "attention") {
        if (v === true) profile.attention = true;
        else delete profile.attention;
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

/**
 * Fija (o quita, con `null`) el hilo de seguimiento de la cuenta. `onlyIfEmpty`: no pisa uno ya fijado
 * (auto-fijado del primer mail nuevo). Toca `profileUpdatedAt` para que los borradores se regeneren.
 */
export async function setFollowupThread(
  id: string,
  thread: { threadId: string; subject: string } | null,
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<ClientRecord | null> {
  const m = await mutateClient(id, (client) => {
    if (opts.onlyIfEmpty && client.profile?.followupThread) return SKIP;
    const profile = { ...client.profile };
    if (thread) {
      profile.followupThread = { threadId: thread.threadId, subject: thread.subject.slice(0, 300), pinnedAt: new Date().toISOString() };
    } else {
      delete profile.followupThread;
    }
    client.profile = profile;
    client.profileUpdatedAt = new Date().toISOString();
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

export interface ActionablePlanChange {
  ticketId: string;
  /** AAAA-MM-DD, o null para volver a la fecha detectada / meta interna. */
  due?: string | null;
  /** Minutos, o null para volver al default. */
  estimateMinutes?: number | null;
  /** Lado manual, o null para volver al detectado. */
  side?: "debo" | "me_deben" | null;
}

/** Fecha y estimación manuales de un accionable. La fecha toca `ticketsUpdatedAt` (aparece en los borradores). */
export async function setActionablePlan(id: string, change: ActionablePlanChange): Promise<ClientRecord | null> {
  const m = await mutateClient(id, (client) => {
    if (change.due !== undefined) {
      const due = { ...client.actionableDue };
      if (change.due) due[change.ticketId] = change.due;
      else delete due[change.ticketId];
      client.actionableDue = due;
      client.ticketsUpdatedAt = new Date().toISOString();
    }
    if (change.side !== undefined) {
      const side = { ...client.actionableSide };
      if (change.side) side[change.ticketId] = change.side;
      else delete side[change.ticketId];
      client.actionableSide = side;
      client.ticketsUpdatedAt = new Date().toISOString();
    }
    if (change.estimateMinutes !== undefined) {
      const est = { ...client.actionableEstimate };
      if (change.estimateMinutes) est[change.ticketId] = change.estimateMinutes;
      else delete est[change.ticketId];
      client.actionableEstimate = est;
    }
  });
  return m?.client ?? null;
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

/**
 * Guarda las sugerencias de transcripción y los hablantes de minutas procesadas (no toca nada más de la reunión).
 * Sin `transcript` solo completa `speakers` (reuniones procesadas antes de guardar hablantes).
 */
export async function setMeetingTranscripts(
  updates: { meetingId: string; transcript?: TranscriptSuggestion[]; speakers?: MeetingSpeaker[] }[],
): Promise<void> {
  if (!updates.length) return;
  const byId = new Map(updates.map((u) => [u.meetingId, u]));
  await mutateClients(null, (client) => {
    let changed = false;
    for (const m of client.meetings) {
      const u = byId.get(m.id);
      if (u) {
        if (u.transcript) m.transcript = u.transcript;
        if (u.speakers) m.speakers = u.speakers;
        changed = true;
      }
    }
    return changed ? true : SKIP;
  });
}

/** ¿Ya se tocó algún accionable de esta reunión (tildado, editado, quitado, con fecha/estimación/lado)? */
export function meetingHasTicketState(client: ClientRecord, meetingId: string): boolean {
  const prefix = `${client.id}:${meetingId}-`;
  const keys = [
    ...(client.doneTicketIds ?? []),
    ...(client.removedTicketIds ?? []),
    ...Object.keys(client.actionableEdits ?? {}),
    ...Object.keys(client.actionableDue ?? {}),
    ...Object.keys(client.actionableEstimate ?? {}),
    ...Object.keys(client.actionableSide ?? {}),
    // El análisis semanal nombra los pasos por ref → id por índice (y las reescrituras dependen de eso).
    ...Object.values(client.analysis?.refs ?? {}),
  ];
  // Solo los pasos por índice (`-0`, `-1`…): el follow-up sintético (`-followup`, auto-tildado) no cuenta.
  return keys.some((k) => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)));
}

/** "[Facundo Miguel Zingone] Revisar endpoints: Analizar…" (formato de `nextSteps` que usa toda la app). */
export const aiStepText = (s: { responsable: string; titulo: string; descripcion: string }) =>
  `${s.responsable.trim() ? `[${s.responsable.trim()}] ` : ""}${s.titulo.trim()}: ${s.descripcion.trim()}`;

/** "Revisar endpoints: resumen corto" (lo que va en el mail). */
export const aiMailText = (s: { titulo: string; resumen_mail: string }) => `${s.titulo.trim()}: ${s.resumen_mail.trim()}`;

/** "14/11" contra la fecha de la reunión → "2026-11-14" (primera ocurrencia desde la reunión). */
export function ddmmToIso(ddmm: string | null, meetingDate: string): string | null {
  const m = ddmm?.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const base = new Date(meetingDate);
  let d = new Date(base.getFullYear(), +m[2] - 1, +m[1]);
  if (d.getTime() < new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) {
    d = new Date(base.getFullYear() + 1, +m[2] - 1, +m[1]);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Guarda el resultado de la IA en la reunión y reemplaza sus `nextSteps` por los accionables generados (más lo ya
 * avanzado, tildado con su fecha): mail y módulo de accionables usan la misma lista. No pisa reuniones cuyos
 * accionables ya se tocaron (los ids dependen del índice). Devuelve false si no aplicó.
 */
export async function setMeetingAI(
  clientId: string,
  meetingId: string,
  out: PostMeetingOutput,
  model: string,
): Promise<"full" | "context" | false> {
  const res = await mutateClient(clientId, (client): "full" | "context" | typeof SKIP => {
    const m = client.meetings.find((x) => x.id === meetingId);
    if (!m || m.ai) return SKIP;
    const now = new Date().toISOString();
    // Accionables ya tocados (tildados, editados, con fecha…): se guarda solo el contexto, sin cambiar los pasos.
    if (meetingHasTicketState(client, meetingId)) {
      m.ai = {
        model,
        generatedAt: now,
        objetivo: out.objetivo,
        puntos: out.puntos_importantes,
        charlamos: out.lo_que_charlamos,
        steps: [],
        revision: out.revision,
        geminiNextSteps: m.nextSteps,
        contextOnly: true,
      };
      delete m.aiError;
      // Sin `ticketsUpdatedAt`: no cambió ningún accionable y así no se regenera un borrador editado.
      return "context";
    }
    const open = out.accionables;
    m.ai = {
      model,
      generatedAt: now,
      objetivo: out.objetivo,
      puntos: out.puntos_importantes,
      charlamos: out.lo_que_charlamos,
      steps: [
        ...open.map((a) => ({
          status: a.status,
          empresa: a.empresa,
          mail: aiMailText(a),
          ...(a.requiere_revision ? { requiereRevision: true } : {}),
        })),
        ...out.ya_avanzamos.map((a) => ({ status: "Hecho" as const, empresa: a.empresa, mail: aiMailText(a) })),
      ],
      revision: out.revision,
      geminiNextSteps: m.nextSteps,
    };
    m.nextSteps = [...open, ...out.ya_avanzamos].map(aiStepText);
    delete m.aiError;

    const id = (i: number) => stepTicketId(client.id, m.id, i);
    const due = Object.fromEntries(
      open.flatMap((a, i) => {
        const iso = ddmmToIso(a.fecha, m.date);
        return iso ? [[id(i), iso]] : [];
      }),
    );
    if (Object.keys(due).length) client.actionableDue = { ...client.actionableDue, ...due };
    const estimates = Object.fromEntries(
      open.flatMap((a, i) => (a.minutos_estimados > 0 ? [[id(i), Math.min(480, Math.max(5, Math.round(a.minutos_estimados / 5) * 5))]] : [])),
    );
    if (Object.keys(estimates).length) client.aiEstimate = { ...client.aiEstimate, ...estimates };
    if (out.ya_avanzamos.length) {
      const doneAt = Object.fromEntries(
        out.ya_avanzamos.map((a, j) => {
          const iso = ddmmToIso(a.fecha, m.date);
          return [id(open.length + j), iso ? `${iso}T12:00:00.000Z` : m.date];
        }),
      );
      client.doneTicketIds = [...new Set([...(client.doneTicketIds ?? []), ...Object.keys(doneAt)])];
      client.doneTicketAt = { ...client.doneTicketAt, ...doneAt };
    }
    client.ticketsUpdatedAt = now;
    return "full";
  });
  return res?.result ?? false;
}

/** Registra un intento fallido de generación (se reintenta en la próxima sync hasta `AI_MAX_ATTEMPTS`). */
export async function markMeetingAIFailed(clientId: string, meetingId: string, error: string): Promise<void> {
  await mutateClient(clientId, (client) => {
    const m = client.meetings.find((x) => x.id === meetingId);
    if (!m) return SKIP;
    m.aiAttempts = (m.aiAttempts ?? 0) + 1;
    m.aiError = error.slice(0, 200);
    return true;
  });
}

/**
 * Acepta (crea un accionable propio con el título elegido y, si se dijo, la fecha) o descarta una sugerencia
 * de la transcripción. Lo descartado queda guardado: frases parecidas no se vuelven a sugerir en la cuenta.
 */
export async function resolveSuggestion(
  id: string,
  input: { suggestionId: string; action: "accept" | "dismiss"; title?: string; due?: string | null },
): Promise<{ client: ClientRecord; ticketId: string | null } | null> {
  const m = await mutateClient(id, (client): string | null | typeof SKIP => {
    const meeting = client.meetings.find((x) => x.transcript?.some((s) => s.id === input.suggestionId));
    const sug = meeting?.transcript?.find((s) => s.id === input.suggestionId);
    if (!meeting || !sug || client.suggestions?.[sug.id]) return SKIP;
    const now = new Date().toISOString();
    let ticketId: string | null = null;
    if (input.action === "accept") {
      const title = (input.title?.trim() || sug.text).slice(0, 500);
      ticketId = `${client.id}:custom-${randomUUID().slice(0, 8)}`;
      client.customActionables = [...(client.customActionables ?? []), { id: ticketId, title, meetingId: meeting.id, createdAt: now }];
      if (input.due) client.actionableDue = { ...client.actionableDue, [ticketId]: input.due };
      client.ticketsUpdatedAt = now;
    }
    client.suggestions = {
      ...client.suggestions,
      [sug.id]: { state: input.action === "accept" ? "accepted" : "dismissed", at: now, text: sug.text, ...(ticketId && { ticketId }) },
    };
    return ticketId;
  });
  return m ? { client: m.client, ticketId: m.result } : null;
}

/** Aplica una corrección aprendida a todo lo guardado (minutas, transcripciones, ediciones, propios, mails). */
export async function applyCorrectionEverywhere(correction: Correction): Promise<number> {
  const fix = (s: string) => applyCorrections(s, [correction]);
  const fixMeetings = (meetings: DiscoveredMeeting[]) => {
    for (const m of meetings) {
      m.title = fix(m.title);
      if (m.summary) m.summary = fix(m.summary);
      m.nextSteps = m.nextSteps.map(fix);
      if (m.milestones) m.milestones = m.milestones.map(fix);
      if (m.decisions) m.decisions = m.decisions.map((d) => ({ ...d, text: fix(d.text) }));
      if (m.transcript) m.transcript = m.transcript.map((t) => ({ ...t, text: fix(t.text), context: fix(t.context) }));
    }
  };
  const changed = await mutateClients(null, (client) => {
    const before = JSON.stringify(client);
    fixMeetings(client.meetings);
    if (client.actionableEdits) {
      client.actionableEdits = Object.fromEntries(Object.entries(client.actionableEdits).map(([k, v]) => [k, fix(v)]));
    }
    client.customActionables = client.customActionables?.map((c) => ({ ...c, title: fix(c.title) }));
    if (client.mailActionables) {
      client.mailActionables = Object.fromEntries(
        Object.entries(client.mailActionables).map(([k, v]) => [k, { ...v, title: fix(v.title) }]),
      );
    }
    if (JSON.stringify(client) === before) return SKIP;
    client.ticketsUpdatedAt = new Date().toISOString();
    return true;
  });
  return changed.size;
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

/** Parecido mínimo para considerar que un accionable nuevo de la IA ya existe en el tablero. */
const AI_DUPLICATE = 0.5;
/** Parecido mínimo con algo que la IA ya agregó antes (aunque se haya quitado): no se repite. */
const AI_LEARNED = 0.6;

export interface AnalysisNewItem {
  /** "[Responsable] Título: descripción" (formato de `nextSteps`). */
  text: string;
  /** AAAA-MM-DD solo si la fecha se acordó. */
  due: string | null;
  /** Lado según la IA: se fija a mano solo si el texto no lo deduce igual. */
  side: "debo" | "me_deben";
  /** Lado que deduciría la app por el "[Dueño]" del texto (`isOwnActionable`). */
  detectedSide: "debo" | "me_deben";
  evidence: string;
  /** Minutos estimados por la IA (0 = sin estimación). */
  minutes?: number;
}

/**
 * Guarda el análisis semanal y agrega al tablero los accionables nuevos que detectó (como propios con origen
 * "ia", asociados a la última reunión). No duplica lo que ya está (parecido a un vigente) ni lo que la IA agregó
 * alguna vez (si lo quitaste, no vuelve). Nunca tilda ni modifica accionables existentes.
 */
export async function setAccountAnalysis(
  clientId: string,
  analysis: Omit<AccountAnalysis, "addedTicketIds" | "rewritesResolved">,
  items: AnalysisNewItem[],
  /** Textos de todo lo pendiente del tablero (`plannedItems`: minuta, propios y mails) para no duplicar. */
  existing: string[] = [],
  /** Minutos estimados por la IA para accionables existentes (ticketId → minutos). */
  estimates: Record<string, number> = {},
): Promise<string[] | null> {
  const res = await mutateClient(clientId, (client): string[] => {
    const now = new Date().toISOString();
    const latest = client.meetings.reduce<DiscoveredMeeting | null>((max, m) => (!max || m.date > max.date ? m : max), null);
    const current = accountActionables(client)
      .filter((a) => !a.done)
      .map((a) => a.step)
      .concat(existing);
    const learned = client.aiLearned ?? [];
    const added: string[] = [];
    if (latest) {
      for (const item of items) {
        const text = item.text.trim().slice(0, 500);
        if (!text) continue;
        if (current.some((c) => keywordSimilarity(c, text) >= AI_DUPLICATE)) continue;
        if (learned.some((l) => keywordSimilarity(l, text) >= AI_LEARNED)) continue;
        const id = `${client.id}:custom-ia-${randomUUID().slice(0, 8)}`;
        client.customActionables = [
          ...(client.customActionables ?? []),
          { id, title: text, meetingId: latest.id, createdAt: now, source: "ia", evidence: item.evidence.slice(0, 300) },
        ];
        if (item.due) client.actionableDue = { ...client.actionableDue, [id]: item.due };
        if (item.side !== item.detectedSide) client.actionableSide = { ...client.actionableSide, [id]: item.side };
        if (item.minutes) estimates[id] = item.minutes;
        learned.push(text);
        current.push(text);
        added.push(id);
      }
    }
    if (Object.keys(estimates).length) client.aiEstimate = { ...client.aiEstimate, ...estimates };
    client.aiLearned = learned.slice(-300);
    client.analysis = { ...analysis, addedTicketIds: added };
    delete client.analysisError;
    if (added.length) client.ticketsUpdatedAt = now;
    return added;
  });
  return res?.result ?? null;
}

/** Registra un análisis fallido (se reintenta en la próxima corrida). */
export async function markAnalysisFailed(clientId: string, message: string): Promise<void> {
  await mutateClient(clientId, (client) => {
    client.analysisError = { at: new Date().toISOString(), message: message.slice(0, 300) };
  });
}

/**
 * Reescritura propuesta por el análisis semanal (modal "Mejoras IA"): aceptar guarda el texto como edición del
 * accionable (`actionableEdits`, no cambia ids ni estado); descartar solo la marca como vista.
 */
export async function resolveRewrite(
  clientId: string,
  ref: string,
  action: "accept" | "dismiss",
  title?: string,
): Promise<ClientRecord | null> {
  const res = await mutateClient(clientId, (client) => {
    const analysis = client.analysis;
    const ticketId = analysis?.refs[ref];
    if (!analysis || !ticketId || analysis.rewritesResolved?.[ref]) return SKIP;
    const proposal = analysis.output.reescrituras?.find((r) => r.ref === ref);
    if (!proposal) return SKIP;
    if (action === "accept") {
      const text = title?.trim().slice(0, 500);
      if (!text) return SKIP;
      client.actionableEdits = { ...client.actionableEdits, [ticketId]: text };
      client.ticketsUpdatedAt = new Date().toISOString();
    }
    analysis.rewritesResolved = { ...analysis.rewritesResolved, [ref]: action === "accept" ? "accepted" : "dismissed" };
    return true;
  });
  return res?.client ?? null;
}

/** Guarda la redacción con IA del mail de seguimiento (solo si la huella sigue siendo la misma que se pidió). */
export async function setStatusAI(clientId: string, value: StatusAI): Promise<boolean> {
  const res = await mutateClient(clientId, (client) => {
    client.statusAI = value;
    return true;
  });
  return Boolean(res);
}
