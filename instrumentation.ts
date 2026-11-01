// Next llama a `register` una vez al iniciar el servidor. Si `CRON_ENABLED=true`, arranca el
// scheduler interno de sincronización (ver `lib/jobs/scheduler.ts`). Solo en runtime Node.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CRON_ENABLED !== "true") return;
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler();
}
