// Envía ahora el resumen de la semana a mi correo (`ownerEmail`, nunca a un cliente). --force lo reenvía aunque
// ya haya salido esta semana. `WEEKLY_DIGEST=draft` en el env lo deja como borrador.
// Uso: pnpm digest:send [-- --force]
import { deliverWeeklyDigest } from "@/lib/integrations/weekly-digest";

deliverWeeklyDigest(new Date(), { force: process.argv.includes("--force") })
  .then((r) => {
    console.log(r.skipped ? "Ya se envió esta semana (usá --force para reenviar)." : r.ok ? `Listo (${r.mode === "send" ? "enviado" : "borrador"}).` : `Error: ${r.error}`);
    if (!r.ok) process.exit(1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
