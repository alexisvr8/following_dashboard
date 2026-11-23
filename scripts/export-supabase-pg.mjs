// Rescate de Supabase por conexión directa a Postgres (solo lectura sobre la base).
// Sirve aunque el proyecto esté restringido (p. ej. exceed_egress_quota): la API responde 402, pero el
// Session pooler sigue aceptando conexiones.
//
// Requiere en .env.local: SUPABASE_DATABASE_URL (o SUPABASE_DB_URL) =
//   postgresql://postgres.<ref>:<contraseña de la base>@aws-0-<región>.pooler.supabase.com:5432/postgres
// (Supabase → Connect → Session pooler; la contraseña es la de la base, no la de la cuenta).
//
// Uso:
//   pnpm export:supabase -- --test     solo prueba la conexión y cuenta filas
//   pnpm export:supabase               copia a .data/rescate-AAAA-MM-DD/ (clients.json + app_state.<clave>.json)
//   pnpm export:supabase -- --local    además la deja lista para STORE_BACKEND=file: lo que había en .data/
//                                      pasa a .data/antes-<fecha-hora>/ y se copian los archivos con sus nombres
// Después de --local: agregar STORE_BACKEND=file al .env.local y reiniciar. Para volver a Supabase:
//   pnpm migrate:supabase -- --merge --dry-run, luego sin --dry-run, y quitar STORE_BACKEND=file.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const url = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Falta SUPABASE_DATABASE_URL en .env.local (Supabase → Connect → Session pooler).");
  process.exit(1);
}

const DATA = path.join(process.cwd(), ".data");
const stamp = new Date().toLocaleString("sv").replace(" ", "_").replace(/:/g, "");
const day = stamp.slice(0, 10);
// Clave de app_state → archivo del modo local (lib/store/backend.ts STATE_FILES). clients_meta y clients_unmatched
// van dentro de clients.json; scheduler_lock no se copia (el candado es de cada proceso).
const STATE_FILES = {
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
};

const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 15, prepare: false });
try {
  const [{ n }] = await sql`select count(*)::int as n from clients`;
  const keys = await sql`select key, length(value::text) as size from app_state order by key`;
  console.log(`Conexión OK · clientes: ${n}`);
  console.log("app_state:", keys.map((k) => `${k.key} (${Math.round(k.size / 1024)} KB)`).join(", "));
  if (args.includes("--test")) process.exit(0);

  const rows = await sql`select data from clients order by seq`;
  const state = Object.fromEntries((await sql`select key, value from app_state`).map((r) => [r.key, r.value]));
  const meta = state.clients_meta ?? {};
  const clientsFile = {
    clients: rows.map((r) => r.data),
    unmatched: state.clients_unmatched ?? [],
    lastScanAt: meta.lastScanAt ?? null,
    ownerEmail: meta.ownerEmail ?? null,
  };

  const out = path.join(DATA, `rescate-${day}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "clients.json"), JSON.stringify(clientsFile, null, 2));
  for (const [key, value] of Object.entries(state)) writeFileSync(path.join(out, `app_state.${key}.json`), JSON.stringify(value, null, 2));
  console.log(`Copia en ${path.relative(process.cwd(), out)}: ${rows.length} clientes + ${Object.keys(state).length} claves de app_state`);

  if (args.includes("--local")) {
    // Lo que había suelto en .data/ (no las carpetas de rescates o respaldos anteriores) se guarda aparte.
    const loose = readdirSync(DATA).filter((f) => f.endsWith(".json") || f.includes(".json."));
    if (loose.length) {
      const prev = path.join(DATA, `antes-${stamp}`);
      mkdirSync(prev);
      for (const f of loose) renameSync(path.join(DATA, f), path.join(prev, f));
      console.log(`Lo anterior de .data/ quedó en ${path.relative(process.cwd(), prev)}`);
    }
    cpSync(path.join(out, "clients.json"), path.join(DATA, "clients.json"));
    for (const [key, file] of Object.entries(STATE_FILES)) {
      const src = path.join(out, `app_state.${key}.json`);
      if (existsSync(src)) cpSync(src, path.join(DATA, file));
    }
    console.log("Listo para modo local: agregá STORE_BACKEND=file al .env.local y reiniciá el servidor.");
  }
} catch (e) {
  console.error("No se pudo:", e.message.replace(/postgres(ql)?:\/\/\S+/g, "<url>").replace(/postgres\.[A-Za-z0-9]+/g, "postgres.<oculto>"));
  process.exit(1);
} finally {
  await sql.end({ timeout: 2 });
}
