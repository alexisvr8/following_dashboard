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
  | "notion_tokens";

/** Archivo local equivalente a cada clave (modo `file`). */
const STATE_FILES: Partial<Record<StateKey, string>> = {
  settings: "settings.json",
  sync_status: "sync-status.json",
  google_tokens: "google-tokens.json",
  notion_tokens: "notion-tokens.json",
};

/** Lee una clave de `app_state` (o su archivo). `null` si no existe. */
export async function getState<T>(key: StateKey): Promise<T | null> {
  if (usingSupabase()) {
    const { data, error } = await supabaseAdmin().from("app_state").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`app_state_read(${key}): ${error.message}`);
    return (data?.value as T) ?? null;
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
    const { error } = value === null ? await table.delete().eq("key", key) : await table.upsert({ key, value });
    if (error) throw new Error(`app_state_write(${key}): ${error.message}`);
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
