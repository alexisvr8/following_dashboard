// Análisis semanal con IA de todas las cuentas asignadas (o de una con --id), guardando como la corrida del lunes:
// `client.analysis` + accionables nuevos al tablero. Salta las ya analizadas esta semana salvo --force.
// Uso: pnpm analyze:accounts [-- --id <clientId>] [--force]   (~US$ 0,15 por cuenta)
import { analyzeAccounts } from "@/lib/integrations/account-analysis";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const t0 = Date.now();
  const res = await analyzeAccounts({ ids: arg("id") ? [arg("id")!] : undefined, force: process.argv.includes("--force") });
  if (res.error) throw new Error(res.error);
  for (const a of res.accounts) {
    console.log(`${a.name} · ${a.skipped ? "ya analizada esta semana" : a.ok ? `ok · ${a.added ?? 0} nuevos` : `ERROR: ${a.error}`}`);
  }
  console.log(
    `Semana ${res.week}: ${res.analyzed} analizadas, ${res.skipped} salteadas, ${res.failed} con error, ${res.added} accionables nuevos · ${Math.round((Date.now() - t0) / 1000)} s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
