import { backfillMeetingNotes, backfillTranscripts, discoverGeminiMeetings } from "@/lib/integrations/gemini-mail";
import { createThreadDraft } from "@/lib/integrations/gmail";
import { syncClientsActivity } from "@/lib/integrations/client-activity";
import {
  followupKey,
  getClientsFile,
  knownMeetingIds,
  mergeDiscovery,
  saveFollowup,
  setClientActivity,
  setMeetingNotes,
  setMeetingTranscripts,
  type ClientsFile,
} from "@/lib/store/clients-store";
import { getSettings, type WorkSettings } from "@/lib/store/settings-store";
import { saveSyncStatus, type SyncStatus } from "@/lib/store/sync-status-store";
import { computeAlerts, type AccountAlert } from "@/lib/utils/followup-alerts";
import { buildFollowup, buildWeeklyPlan } from "@/lib/utils/followup";
import { getSyncStatus } from "@/lib/store/sync-status-store";
import { followupTicketId } from "@/lib/store/clients-store";

// Sincronización completa (la usan el scheduler de `instrumentation.ts` y `/api/cron/*`):
// 1) minutas nuevas de Gemini Notes (incremental), 2) actividad de mails/reuniones de clientes
// asignados y no asignados, 3) borrador de minuta de cada reunión nueva (si `settings.autoMeetingDrafts`),
// 4) alertas y, si `drafts` (lunes), el borrador semanal de objetivos por cuenta. Nunca envía mails.

/** Días hacia atrás que se re-escanean en cada corrida (los mails ya procesados se saltan). */
const DISCOVERY_DAYS = 7;

export interface SyncOptions {
  drafts: boolean;
  trigger: "scheduler" | "api";
}

export type SyncResult =
  | { skipped: true }
  | (SyncStatus & {
      skipped: false;
      alertList: { id: string; kind: AccountAlert["kind"]; days: number }[];
      drafts: { clientId: string; ok: boolean; error?: string }[];
    });

const g = globalThis as unknown as { __syncRunning?: Promise<SyncResult> | null };

/** Evita corridas simultáneas: si ya hay una en curso devuelve `{ skipped: true }`. */
export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  if (g.__syncRunning) return { skipped: true };
  g.__syncRunning = doSync(opts);
  try {
    return await g.__syncRunning;
  } finally {
    g.__syncRunning = null;
  }
}

async function doSync({ drafts: withDrafts, trigger }: SyncOptions): Promise<SyncResult> {
  const started = Date.now();
  // El último mail semanal se conserva entre corridas (el scheduler lo usa para no repetirlo ni saltearlo).
  const { lastWeeklyDraftsAt } = await getSyncStatus();
  const status: SyncStatus = {
    lastWeeklyDraftsAt,
    lastRunAt: new Date().toISOString(),
    ok: false,
    trigger,
    withDrafts,
    newMeetings: 0,
    newClients: 0,
    synced: 0,
    failed: 0,
    alerts: 0,
    draftsCreated: 0,
    durationMs: 0,
    error: null,
  };
  let alertList: { id: string; kind: AccountAlert["kind"]; days: number }[] = [];
  const drafts: { clientId: string; ok: boolean; error?: string }[] = [];

  try {
    // 1) Minutas nuevas → reuniones (y con ellas, accionables de la última minuta).
    const known = knownMeetingIds(await getClientsFile());
    const discovery = await discoverGeminiMeetings(DISCOVERY_DAYS, known);
    if (!discovery) throw new Error("google_not_connected");
    const before = countMeetings(await getClientsFile());
    const { file: merged, newClients } = await mergeDiscovery(discovery.result);
    status.newMeetings = countMeetings(merged) - before;
    status.newClients = newClients;
    await setMeetingNotes(await backfillMeetingNotes(merged));
    await setMeetingTranscripts(await backfillTranscripts(await getClientsFile()));

    // 2) Actividad (mails en cualquier dirección con cualquier persona del cliente + última reunión).
    const targets = merged.clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
    const results = await syncClientsActivity(targets, merged.ownerEmail ?? null, merged.clients);
    if (!results) throw new Error("google_not_connected");
    const ok = results.filter((r) => !r.error);
    await setClientActivity(ok);
    status.synced = ok.length;
    status.failed = results.length - ok.length;

    // 3) Minuta en borrador apenas llega la nota de Gemini (y ya se sincronizaron hilos y destinatarios).
    const file = await getClientsFile();
    const settings = await getSettings();
    if (settings.autoMeetingDrafts) {
      const made = await createMeetingDrafts(file, settings);
      status.meetingDrafts = made.filter((d) => d.ok).length;
      drafts.push(...made);
    }

    // 4) Alertas; con `drafts` (lunes 08:30), el mail semanal de objetivos por cuenta.
    const alerts = computeAlerts(file.clients, settings);
    alertList = alerts.map((a) => ({ id: a.clientId, kind: a.kind, days: a.businessDays }));
    status.alerts = alerts.length;
    if (withDrafts) {
      const weekly = await createWeeklyDrafts(file, settings);
      drafts.push(...weekly);
      status.draftsCreated = weekly.filter((d) => d.ok).length;
      status.lastWeeklyDraftsAt = new Date().toISOString();
    }
    status.ok = true;
  } catch (error) {
    status.error = (error as Error).message;
  }

  status.durationMs = Date.now() - started;
  await saveSyncStatus(status);
  return { ...status, skipped: false, alertList, drafts };
}

function countMeetings(file: ClientsFile): number {
  return file.clients.reduce((n, c) => n + c.meetings.length, 0);
}

/** Lunes de la semana de `d` (AAAA-MM-DD, hora local): clave del mail semanal. */
export function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/**
 * Lunes: por cada cuenta asignada con pendientes, UN borrador con los objetivos de la semana (lo que debo y lo
 * que me deben + lo completado la semana pasada), en el hilo más reciente. Clave `week:<lunes>`: una vez por
 * semana; si se corre de nuevo, actualiza ese mismo borrador (no lo duplica) mientras no se haya enviado.
 */
async function createWeeklyDrafts(file: ClientsFile, settings: WorkSettings) {
  const out: { clientId: string; ok: boolean; error?: string }[] = [];
  const key = `week:${weekKey(new Date())}`;
  for (const client of file.clients) {
    if (client.status !== "assigned") continue;
    const meeting = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!meeting) continue;
    const previous = client.followups?.[key];
    if (previous?.sentAt) continue;
    const draft = buildWeeklyPlan(client, meeting, file.ownerEmail ?? null, settings);
    if (!draft || !draft.to.length) continue;
    const threadId = draft.threadId ?? client.activity?.threads[0]?.threadId ?? null;
    try {
      const created = await createThreadDraft(
        { threadId, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body },
        previous?.gmailDraftId,
      );
      await saveFollowup(client.id, key, {
        ...draft,
        gmailDraftId: created.draftId,
        gmailMessageId: created.messageId,
        threadId: created.threadId,
        draftCreatedAt: new Date().toISOString(),
        gmailBody: draft.body,
        autoFor: key,
      });
      out.push({ clientId: client.id, ok: true });
    } catch (error) {
      out.push({ clientId: client.id, ok: false, error: (error as Error).message });
    }
  }
  return out;
}

/** Ventana para crear la minuta sola: reuniones de las últimas 48 h (no se generan para minutas viejas). */
const MEETING_DRAFT_HOURS = 48;

/**
 * Por cada cuenta asignada cuya ÚLTIMA reunión es nueva (≤48 h) deja la minuta como borrador en Gmail,
 * dentro del hilo más reciente con el cliente. Una sola vez por reunión (`autoFor` = id de la reunión) y nunca
 * si ya hay borrador, ya se envió, ya tildaste "Enviar follow-up" o ya le escribiste al cliente después.
 */
async function createMeetingDrafts(file: ClientsFile, settings: WorkSettings) {
  const out: { clientId: string; ok: boolean; error?: string }[] = [];
  const since = Date.now() - MEETING_DRAFT_HOURS * 3_600_000;
  for (const client of file.clients) {
    if (client.status !== "assigned") continue;
    const meeting = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!meeting || Date.parse(meeting.date) < since) continue;
    const key = followupKey("meeting", meeting.id);
    const saved = client.followups?.[key];
    if (saved?.gmailDraftId || saved?.sentAt || saved?.autoFor === meeting.id) continue;
    if (client.doneTicketIds?.includes(followupTicketId(client.id, meeting.id))) continue;
    const wroteAfter = (client.activity?.recentMails ?? []).some((m) => m.direction === "me" && m.date > meeting.date);
    if (wroteAfter) continue;
    const draft = buildFollowup(client, meeting, file.ownerEmail ?? null, settings);
    if (!draft.to.length) continue;
    const threadId = client.activity?.threads[0]?.threadId ?? null;
    try {
      const created = await createThreadDraft({ threadId, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body });
      await saveFollowup(client.id, key, {
        ...draft,
        gmailDraftId: created.draftId,
        gmailMessageId: created.messageId,
        threadId: created.threadId,
        draftCreatedAt: new Date().toISOString(),
        gmailBody: draft.body,
        autoFor: meeting.id,
      });
      out.push({ clientId: client.id, ok: true });
    } catch (error) {
      out.push({ clientId: client.id, ok: false, error: (error as Error).message });
    }
  }
  return out;
}
