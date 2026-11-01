import { discoverGeminiMeetings } from "@/lib/integrations/gemini-mail";
import { createThreadDraft } from "@/lib/integrations/gmail";
import { syncClientsActivity } from "@/lib/integrations/client-activity";
import {
  followupKey,
  getClientsFile,
  knownMeetingIds,
  mergeDiscovery,
  saveFollowup,
  setClientActivity,
  type ClientsFile,
} from "@/lib/store/clients-store";
import { getSettings, type WorkSettings } from "@/lib/store/settings-store";
import { saveSyncStatus, type SyncStatus } from "@/lib/store/sync-status-store";
import { computeAlerts, type AccountAlert } from "@/lib/utils/followup-alerts";
import { buildStatusUpdate } from "@/lib/utils/followup";

// Sincronización completa (la usan el scheduler de `instrumentation.ts` y `/api/cron/*`):
// 1) minutas nuevas de Gemini Notes (incremental), 2) actividad de mails/reuniones de clientes
// asignados y no asignados, 3) alertas y, si `drafts`, borradores de actualización en Gmail.
// Nunca envía mails.

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
  const status: SyncStatus = {
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
  let drafts: { clientId: string; ok: boolean; error?: string }[] = [];

  try {
    // 1) Minutas nuevas → reuniones (y con ellas, accionables de la última minuta).
    const known = knownMeetingIds(await getClientsFile());
    const discovery = await discoverGeminiMeetings(DISCOVERY_DAYS, known);
    if (!discovery) throw new Error("google_not_connected");
    const before = countMeetings(await getClientsFile());
    const { file: merged, newClients } = await mergeDiscovery(discovery.result);
    status.newMeetings = countMeetings(merged) - before;
    status.newClients = newClients;

    // 2) Actividad (mails en cualquier dirección con cualquier persona del cliente + última reunión).
    const targets = merged.clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
    const results = await syncClientsActivity(targets, merged.ownerEmail ?? null, merged.clients);
    if (!results) throw new Error("google_not_connected");
    const ok = results.filter((r) => !r.error);
    await setClientActivity(ok);
    status.synced = ok.length;
    status.failed = results.length - ok.length;

    // 3) Alertas (+ borradores una vez al día).
    const file = await getClientsFile();
    const settings = await getSettings();
    const alerts = computeAlerts(file.clients, settings);
    alertList = alerts.map((a) => ({ id: a.clientId, kind: a.kind, days: a.businessDays }));
    status.alerts = alerts.length;
    if (withDrafts) {
      drafts = await createAlertDrafts(file, settings, alerts);
      status.draftsCreated = drafts.filter((d) => d.ok).length;
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

/** Por cada cuenta alertada deja UN borrador de actualización en Gmail por movimiento (dedupe `autoFor`). */
async function createAlertDrafts(file: ClientsFile, settings: WorkSettings, alerts: AccountAlert[]) {
  const drafts: { clientId: string; ok: boolean; error?: string }[] = [];
  for (const alert of alerts) {
    const client = file.clients.find((c) => c.id === alert.clientId);
    if (!client) continue;
    const meeting = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!meeting) continue;
    const key = followupKey("status", meeting.id);
    if (client.followups?.[key]?.autoFor === alert.lastMovementAt) continue; // ya generado
    const draft = buildStatusUpdate(client, meeting, file.ownerEmail ?? null, settings);
    if (!draft.to.length) continue;
    const threadId = client.activity?.threads[0]?.threadId ?? null;
    try {
      const created = await createThreadDraft({ threadId, to: draft.to, subject: draft.subject, body: draft.body });
      await saveFollowup(client.id, key, {
        ...draft,
        gmailDraftId: created.draftId,
        gmailMessageId: created.messageId,
        threadId: created.threadId,
        draftCreatedAt: new Date().toISOString(),
        autoFor: alert.lastMovementAt,
      });
      drafts.push({ clientId: client.id, ok: true });
    } catch (error) {
      drafts.push({ clientId: client.id, ok: false, error: (error as Error).message });
    }
  }
  return drafts;
}
