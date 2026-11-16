import { runSync } from "@/lib/jobs/sync-job";
import { getSyncStatus } from "@/lib/store/sync-status-store";
import { getSchedulerLock, lockIsFresh, schedulerId } from "@/lib/jobs/scheduler-lock";

// GET: estado de la última sincronización (lo consulta `SyncStatus` en el header), con qué equipo corre la
// automática (`schedulerHost`, null si nadie tiene el candado vigente) y si es este (`schedulerHere`).
export async function GET() {
  const [status, lock] = await Promise.all([getSyncStatus(), getSchedulerLock().catch(() => null)]);
  const active = lockIsFresh(lock) ? lock : null;
  return Response.json({
    ...status,
    schedulerEnabled: process.env.CRON_ENABLED === "true",
    schedulerHost: active?.host ?? null,
    schedulerHere: active?.owner === schedulerId(),
  });
}

// POST (header `x-cron-secret`): sincronización completa para un cron externo. `?drafts=1` crea borradores.
export async function POST(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSync({ drafts: new URL(req.url).searchParams.get("drafts") === "1", trigger: "api" });
  return Response.json(result, { status: result.skipped ? 409 : 200 });
}
