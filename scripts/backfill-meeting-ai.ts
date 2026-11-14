// Puesta al día de minutas con IA (lo cargado antes de AI_SINCE, por reglas): última reunión de cada cuenta asignada.
//   A = sin accionables tocados → la IA reemplaza los pasos (como una reunión nueva).
//   B = con accionables tocados → solo contexto (objetivo / puntos / charlamos), sin cambiar pasos ni ids.
// Uso: pnpm backfill:meeting-ai [-- --dry-run] [--id <clientId>] [--limit N]
//   --dry-run lista el plan sin llamar a la API (~US$ 0,10 por reunión si no).
import { backfillMeetingAI } from "@/lib/integrations/meeting-ai";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await backfillMeetingAI({
    dryRun,
    ids: arg("id") ? [arg("id")!] : undefined,
    limit: arg("limit") ? Number(arg("limit")) : undefined,
  });
  for (const r of rows) {
    const mode = r.plan === "full" ? "A (reemplaza pasos)" : "B (solo contexto)";
    console.log(`${r.date.slice(0, 10)} · ${r.clientName} · ${r.meetingTitle.slice(0, 50)} → ${mode}${r.result ? ` · ${r.result}${r.error ? `: ${r.error}` : ""}` : ""}`);
  }
  console.log(`${rows.length} reuniones${dryRun ? " (dry-run, sin costo)" : ""}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
