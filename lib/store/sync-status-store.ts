import { getState, setState } from "@/lib/store/backend";

// Resultado de la última sincronización automática/manual (`runSync`). `app_state.sync_status` (o `.data/sync-status.json`).
export interface SyncStatus {
  lastRunAt: string | null;
  ok: boolean;
  trigger: "scheduler" | "api" | null;
  withDrafts: boolean;
  newMeetings: number;
  newClients: number;
  synced: number;
  failed: number;
  alerts: number;
  draftsCreated: number;
  /** Borradores de minuta creados solos tras una reunión nueva. */
  meetingDrafts?: number;
  /** Reuniones procesadas con IA en la corrida (mail post-reunión + accionables). */
  aiMeetings?: number;
  /** Última vez que se generaron los borradores semanales de objetivos (lunes 08:30). */
  lastWeeklyDraftsAt?: string | null;
  /** Última corrida que cambió datos (reuniones, mails, borradores…): la UI solo refresca cuando cambia. */
  lastChangeAt?: string | null;
  durationMs: number;
  error: string | null;
}

export const EMPTY_SYNC_STATUS: SyncStatus = {
  lastRunAt: null,
  ok: false,
  trigger: null,
  withDrafts: false,
  newMeetings: 0,
  newClients: 0,
  synced: 0,
  failed: 0,
  alerts: 0,
  draftsCreated: 0,
  durationMs: 0,
  error: null,
};

export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    return { ...EMPTY_SYNC_STATUS, ...((await getState<Partial<SyncStatus>>("sync_status")) ?? {}) };
  } catch {
    return { ...EMPTY_SYNC_STATUS };
  }
}

export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  await setState("sync_status", status);
}
