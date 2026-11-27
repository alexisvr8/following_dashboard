import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Dónde vive el estado: Supabase (servidor) o `.data/*.json` (local). `STORE_BACKEND` manda; si
// falta, se usa Supabase solo cuando está configurada la service_role.
export function usingSupabase(): boolean {
  const mode = process.env.STORE_BACKEND;
  if (mode === "file") return false;
  if (mode === "supabase") return true;
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export const DATA_DIR = path.join(process.cwd(), ".data");

export type StateKey =
  | "clients_meta"
  | "clients_unmatched"
  | "settings"
  | "sync_status"
  | "google_tokens"
  | "notion_tokens"
  | "weekly_ai"
  | "ai_usage"
  | "board_order"
  | "scheduler_lock"
  | "unassigned_mails"
  | "supabase_egress"
  | "not_today"
  | "google_pause";

/** Archivo local equivalente a cada clave (modo `file`). */
const STATE_FILES: Partial<Record<StateKey, string>> = {
  settings: "settings.json",
  sync_status: "sync-status.json",
  google_tokens: "google-tokens.json",
  notion_tokens: "notion-tokens.json",
  weekly_ai: "weekly-ai.json",
  ai_usage: "ai-usage.json",
  board_order: "board-order.json",
  scheduler_lock: "scheduler-lock.json",
  unassigned_mails: "unassigned-mails.json",
  supabase_egress: "supabase-egress.json",
  not_today: "not-today.json",
  google_pause: "google-pause.json",
};

// Caché en memoria por `updated_at` (egress de Supabase): las claves grandes (`clients_unmatched`, `ai_usage`…)
// se leen muchas veces por sincronización; `value` solo se baja cuando cambió. Se entregan copias.
type CachedState = { updatedAt: string; value: unknown };
const stateCache: Map<StateKey, CachedState> = ((globalThis as { __appStateCache?: Map<StateKey, CachedState> })
  .__appStateCache ??= new Map());
/** Por debajo de esto no vale la pena el viaje extra para consultar `updated_at`. */
const SMALL_STATE_CHARS = 4_000;

function cacheState(key: StateKey, updatedAt: string, value: unknown): void {
  if (JSON.stringify(value).length > SMALL_STATE_CHARS) stateCache.set(key, { updatedAt, value: structuredClone(value) });
  else stateCache.delete(key);
}

/** Lee una clave de `app_state` (o su archivo). `null` si no existe. */
export async function getState<T>(key: StateKey): Promise<T | null> {
  if (usingSupabase()) {
    const table = () => supabaseAdmin().from("app_state");
    const cached = stateCache.get(key);
    if (cached) {
      const { data, error } = await table().select("updated_at").eq("key", key).maybeSingle();
      if (error) throw new Error(`app_state_read(${key}): ${error.message}`);
      if (data?.updated_at === cached.updatedAt) return structuredClone(cached.value) as T;
      stateCache.delete(key);
      if (!data) return null;
    }
    const { data, error } = await table().select("value, updated_at").eq("key", key).maybeSingle();
    if (error) throw new Error(`app_state_read(${key}): ${error.message}`);
    if (!data) return null;
    cacheState(key, data.updated_at as string, data.value);
    return data.value as T;
  }
  const file = STATE_FILES[key];
  if (!file) throw new Error(`state_key_without_file: ${key}`);
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Escribe (o borra con `null`) una clave de `app_state` (o su archivo). */
export async function setState(key: StateKey, value: unknown): Promise<void> {
  if (usingSupabase()) {
    const table = supabaseAdmin().from("app_state");
    stateCache.delete(key);
    if (value === null) {
      const { error } = await table.delete().eq("key", key);
      if (error) throw new Error(`app_state_write(${key}): ${error.message}`);
      return;
    }
    const { data, error } = await table.upsert({ key, value }).select("updated_at").single();
    if (error) throw new Error(`app_state_write(${key}): ${error.message}`);
    if (data) cacheState(key, data.updated_at as string, value);
    return;
  }
  const file = STATE_FILES[key];
  if (!file) throw new Error(`state_key_without_file: ${key}`);
  const target = path.join(DATA_DIR, file);
  if (value === null) {
    const { rm } = await import("fs/promises");
    await rm(target, { force: true });
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2), "utf-8");
}
