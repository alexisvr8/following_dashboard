// Sube `.data/*.json` a Supabase (tablas de supabase/migrations/0002_app_store.sql).
// Uso: pnpm migrate:supabase [--merge [--dry-run] | --force]
// - Sin flags: carga inicial; se niega si `clients` ya tiene datos.
// - --merge: combina `.data/clients.json` (p. ej. de otra PC) con lo que ya hay, sin perder trabajo
//   manual de ningún lado (ver merge-clients.mjs). Respalda Supabase en `.data/` antes de escribir.
//   Con --dry-run solo muestra qué cambiaría.
// - --force: sobrescribe cada cliente con la versión del archivo (pierde lo hecho solo en Supabase).
// - --restore [--dry-run] [--accept-diff]: vuelta del modo archivo (rescate): lo local manda y se sube todo
//   (cuentas con version+1 y todas las claves de app_state). Ver runRestore.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { diffSummary, mergeClient, sameJson } from "./merge-clients.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const force = process.argv.includes("--force");
const merge = process.argv.includes("--merge");
const dryRun = process.argv.includes("--dry-run");
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
if (merge) {
  await runMerge();
  process.exit(0);
}
if (process.argv.includes("--restore")) {
  await runRestore();
  process.exit(0);
}
if (existing.length && !force) {
  console.error("Supabase ya tiene clientes. Usa --merge para combinar (recomendado) o --force para sobrescribir.");
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

async function runMerge() {
  const file = await readJson("clients.json");
  if (!file) throw new Error("No hay .data/clients.json para combinar.");

  const { data: rows, error } = await db.from("clients").select("id, data, version");
  check("clients (lectura)", { error });
  const { data: state, error: stateError } = await db.from("app_state").select("key, value");
  check("app_state (lectura)", { error: stateError });
  const stateMap = Object.fromEntries(state.map((r) => [r.key, r.value]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const updates = [];
  const inserts = [];
  for (const local of file.clients) {
    const row = byId.get(local.id);
    if (!row) {
      inserts.push(local);
      console.log(`+ ${local.name} (${local.id}): nuevo, ${local.meetings.length} reuniones`);
      continue;
    }
    const { merged, conflicts } = mergeClient(row.data, local);
    for (const c of conflicts) console.log(`! ${row.data.name} (${local.id}): conflicto de ${c} → se deja el de la base; corrígelo en /clientes si hace falta`);
    if (sameJson(merged, row.data)) continue;
    updates.push({ row, merged });
    console.log(`~ ${merged.name} (${local.id}): ${diffSummary(row.data, merged).join(", ") || "detalles menores"}`);
  }

  const matched = new Set([...rows.flatMap((r) => r.data.meetings), ...file.clients.flatMap((c) => c.meetings)].map((m) => m.id));
  const unmatchedBefore = stateMap.clients_unmatched ?? [];
  const known = new Set(unmatchedBefore.map((m) => m.id));
  const unmatched = [...unmatchedBefore, ...(file.unmatched ?? []).filter((m) => !known.has(m.id))]
    .filter((m) => !matched.has(m.id))
    .sort((a, b) => b.date.localeCompare(a.date));
  const metaBefore = stateMap.clients_meta ?? { lastScanAt: null };
  const meta = {
    lastScanAt: [metaBefore.lastScanAt, file.lastScanAt].filter(Boolean).sort().pop() ?? null,
    ownerEmail: metaBefore.ownerEmail ?? file.ownerEmail ?? null,
  };

  console.log(`\nResumen: ${inserts.length} clientes nuevos, ${updates.length} combinados, ` +
    `${rows.length - updates.length} sin cambios, sin cliente ${unmatchedBefore.length}→${unmatched.length}.`);
  if (dryRun) {
    console.log("--dry-run: no se escribió nada.");
    return;
  }

  const backup = path.join(DATA, `supabase-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(backup, JSON.stringify({ clients: rows, app_state: state }, null, 2));
  console.log(`Respaldo de Supabase: ${backup}`);

  if (inserts.length) {
    check("clients (alta)", await db.from("clients").insert(
      inserts.map((c) => ({ id: c.id, status: c.status, name: c.name, domain: c.domain, data: c })),
    ));
  }
  for (const { row, merged } of updates) {
    // Misma regla que la app: solo si nadie cambió la fila desde que se leyó.
    const { data, error: updateError } = await db.from("clients")
      .update({ status: merged.status, name: merged.name, domain: merged.domain, data: merged, version: row.version + 1 })
      .eq("id", row.id).eq("version", row.version).select("id");
    check(`clients (${row.id})`, { error: updateError });
    if (!data.length) throw new Error(`${row.id} cambió mientras se combinaba (¿la app está sincronizando?). Vuelve a correr --merge.`);
  }
  check("clients_unmatched", await db.from("app_state").upsert({ key: "clients_unmatched", value: unmatched }));
  check("clients_meta", await db.from("app_state").upsert({ key: "clients_meta", value: meta }));

  // Config y tokens: solo si Supabase todavía no los tiene (los de la base ya están en uso).
  for (const [key, name] of [["settings", "settings.json"], ["google_tokens", "google-tokens.json"], ["notion_tokens", "notion-tokens.json"]]) {
    if (stateMap[key]) continue;
    const value = await readJson(name);
    if (value) check(key, await db.from("app_state").upsert({ key, value }));
    if (value) console.log(`${key}: subido (no existía en Supabase)`);
  }
  console.log("Listo.");
}

// Claves de app_state y su archivo en modo `file` (igual que lib/store/backend.ts). `scheduler_lock` no se sube:
// el candado lo toma el equipo que arranque.
function stateFiles() { return {
  settings: "settings.json",
  sync_status: "sync-status.json",
  google_tokens: "google-tokens.json",
  notion_tokens: "notion-tokens.json",
  weekly_ai: "weekly-ai.json",
  ai_usage: "ai-usage.json",
  board_order: "board-order.json",
  unassigned_mails: "unassigned-mails.json",
  supabase_egress: "supabase-egress.json",
  not_today: "not-today.json",
  google_pause: "google-pause.json",
}; }

// Vuelta del modo archivo (después de `export:supabase --local`): lo de `.data/` es la verdad. Antes de escribir
// verifica que la base siga igual que el último rescate (`.data/rescate-*/clients.json`); si alguna cuenta cambió
// (p. ej. otro equipo escribió), se niega salvo `--accept-diff`. Cuentas que solo están en la base se conservan.
async function runRestore() {
  const file = await readJson("clients.json");
  if (!file) throw new Error("No hay .data/clients.json para subir.");
  const rescueDir = (await readdir(DATA)).filter((n) => n.startsWith("rescate-")).sort().pop();
  if (!rescueDir) throw new Error("No hay carpeta .data/rescate-* para verificar la base.");
  const rescue = JSON.parse(await readFile(path.join(DATA, rescueDir, "clients.json"), "utf-8"));

  const { data: rows, error } = await db.from("clients").select("id, data, version");
  check("clients (lectura)", { error });
  const { data: state, error: stateError } = await db.from("app_state").select("key, value");
  check("app_state (lectura)", { error: stateError });
  const stateMap = Object.fromEntries(state.map((r) => [r.key, r.value]));

  // 1) ¿La base cambió desde el rescate?
  const rescueById = new Map(rescue.clients.map((c) => [c.id, c]));
  const changed = rows.filter((r) => !rescueById.has(r.id) || !sameJson(r.data, rescueById.get(r.id)));
  console.log(`Base: ${rows.length} cuentas · rescate ${rescueDir}: ${rescue.clients.length} · cambiadas desde el rescate: ${changed.length}`);
  for (const r of changed) console.log(`  ! ${r.data.name} (${r.id}) ${rescueById.has(r.id) ? "distinta al rescate" : "no está en el rescate"}`);
  for (const key of Object.keys(stateFiles())) {
    let saved = null;
    try { saved = JSON.parse(await readFile(path.join(DATA, rescueDir, `app_state.${key}.json`), "utf-8")); } catch {}
    if (saved && stateMap[key] && !sameJson(saved, stateMap[key])) console.log(`  · app_state.${key} distinto al rescate`);
  }
  if (changed.length && !process.argv.includes("--accept-diff")) {
    throw new Error("La base cambió después del rescate: revisa esas cuentas (o usa --merge). --accept-diff las pisa igual.");
  }

  // 2) Qué se sube.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const localIds = new Set(file.clients.map((c) => c.id));
  const updates = file.clients.filter((c) => byId.has(c.id) && !sameJson(c, byId.get(c.id).data));
  const inserts = file.clients.filter((c) => !byId.has(c.id));
  const onlyDb = rows.filter((r) => !localIds.has(r.id));
  for (const c of inserts) console.log(`  + ${c.name} (${c.id}) nueva`);
  for (const r of onlyDb) console.log(`  = ${r.data.name} (${r.id}) solo en la base: se conserva`);
  const stateUploads = [];
  for (const [key, name] of Object.entries(stateFiles())) {
    let value = await readJson(name);
    if (value == null) continue;
    if (key === "supabase_egress") {
      // Medido por día: se queda el mayor de cada lado.
      const merged = { ...stateMap[key] };
      for (const [d, v] of Object.entries(value)) if (!merged[d] || v.bytes > merged[d].bytes) merged[d] = v;
      value = merged;
    }
    if (!sameJson(value, stateMap[key])) stateUploads.push([key, value]);
  }
  const meta = { lastScanAt: file.lastScanAt ?? null, ownerEmail: file.ownerEmail ?? null };
  stateUploads.push(["clients_meta", meta], ["clients_unmatched", file.unmatched ?? []]);
  console.log(`\nResumen: ${updates.length} cuentas actualizadas, ${inserts.length} nuevas, ` +
    `${file.clients.length - updates.length - inserts.length} iguales, ${onlyDb.length} solo en la base · ` +
    `app_state: ${stateUploads.map(([k]) => k).join(", ")}`);
  if (dryRun) {
    console.log("--dry-run: no se escribió nada.");
    return;
  }

  // 3) Respaldo y escritura (version+1, solo si nadie tocó la fila desde la lectura).
  const backup = path.join(DATA, `supabase-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(backup, JSON.stringify({ clients: rows, app_state: state }, null, 2));
  console.log(`Respaldo de Supabase: ${backup}`);
  for (const c of updates) {
    const row = byId.get(c.id);
    const { data, error: updateError } = await db.from("clients")
      .update({ status: c.status, name: c.name, domain: c.domain, data: c, version: row.version + 1 })
      .eq("id", c.id).eq("version", row.version).select("id");
    check(`clients (${c.id})`, { error: updateError });
    if (!data.length) throw new Error(`${c.id} cambió mientras se subía (¿la app corre contra Supabase?). Vuelve a correr --restore.`);
  }
  if (inserts.length) {
    check("clients (alta)", await db.from("clients").insert(
      inserts.map((c) => ({ id: c.id, status: c.status, name: c.name, domain: c.domain, data: c })),
    ));
  }
  for (const [key, value] of stateUploads) check(key, await db.from("app_state").upsert({ key, value }));
  console.log("Listo. Quita STORE_BACKEND=file de .env.local y reinicia la app.");
}
