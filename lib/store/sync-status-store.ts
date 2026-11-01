import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Resultado de la última sincronización automática/manual (`runSync`). Archivo `.data/sync-status.json`.
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
  durationMs: number;
  error: string | null;
}

const FILE = path.join(process.cwd(), ".data", "sync-status.json");

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
    return { ...EMPTY_SYNC_STATUS, ...(JSON.parse(await readFile(FILE, "utf-8")) as Partial<SyncStatus>) };
  } catch {
    return { ...EMPTY_SYNC_STATUS };
  }
}

export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(status, null, 2), "utf-8");
}
