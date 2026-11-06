// Sube `.data/*.json` a Supabase (tablas de supabase/migrations/0002_app_store.sql).
// Uso: pnpm migrate:supabase [--force]
// Sin --force se niega si la tabla `clients` ya tiene datos (para no pisar lo que el servidor ya sincronizó).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const force = process.argv.includes("--force");
const db = createClient(url, key, { auth: { persistSession: false } });
const DATA = path.join(process.cwd(), ".data");

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${name}: ${error.message}`);
  }
}

function check(label, { error }) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

// Sin `head: true`: así un error de URL o de esquema sale aquí y no en silencio.
const { data: existing, error: countError } = await db.from("clients").select("id").limit(1);
if (countError) throw new Error(`¿Aplicaste 0002_app_store.sql y la URL es la base (sin /rest/v1)? ${countError.message}`);
if (existing.length && !force) {
  console.error("Supabase ya tiene clientes. Usa --force para sobrescribir con .data/clients.json.");
  process.exit(1);
}

const file = await readJson("clients.json");
if (file) {
  const rows = file.clients.map((c) => ({ id: c.id, status: c.status, name: c.name, domain: c.domain, data: c }));
  for (let i = 0; i < rows.length; i += 20) {
    check("clients", await db.from("clients").upsert(rows.slice(i, i + 20), { onConflict: "id" }));
  }
  check("clients_meta", await db.from("app_state").upsert({
    key: "clients_meta",
    value: { lastScanAt: file.lastScanAt ?? null, ownerEmail: file.ownerEmail ?? null },
  }));
  check("clients_unmatched", await db.from("app_state").upsert({ key: "clients_unmatched", value: file.unmatched ?? [] }));
  console.log(`clients: ${rows.length} · sin cliente: ${(file.unmatched ?? []).length}`);
}

for (const [key, name] of [
  ["settings", "settings.json"],
  ["sync_status", "sync-status.json"],
  ["google_tokens", "google-tokens.json"],
  ["notion_tokens", "notion-tokens.json"],
]) {
  const value = await readJson(name);
  if (value == null) continue;
  check(key, await db.from("app_state").upsert({ key, value }));
  console.log(`${key}: ok`);
}
console.log("Listo.");
