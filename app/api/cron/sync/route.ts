import { runSync } from "@/lib/jobs/sync-job";
import { getSyncStatus } from "@/lib/store/sync-status-store";

// GET: estado de la última sincronización (lo consulta `SyncStatus` en el header).
export async function GET() {
  return Response.json({ ...(await getSyncStatus()), schedulerEnabled: process.env.CRON_ENABLED === "true" });
}

// POST (header `x-cron-secret`): sincronización completa para un cron externo. `?drafts=1` crea borradores.
export async function POST(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSync({ drafts: new URL(req.url).searchParams.get("drafts") === "1", trigger: "api" });
  return Response.json(result, { status: result.skipped ? 409 : 200 });
}
