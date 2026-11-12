import { runSync } from "@/lib/jobs/sync-job";

// Cron diario (externo, días hábiles): minutas nuevas + actividad de clientes + alertas y, por cada
// cuenta alertada, UN borrador de actualización en Gmail por movimiento — nunca envía.
// (`drafts` = borrador semanal de objetivos por cuenta) `?drafts=0` solo sincroniza. Equivale a `POST /api/cron/sync?drafts=1` (ver `lib/jobs/sync-job.ts`).
export async function POST(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runSync({ drafts: new URL(req.url).searchParams.get("drafts") !== "0", trigger: "api" });
  if (result.skipped) return Response.json({ skipped: true }, { status: 409 });
  if (result.error === "google_not_connected") return Response.json({ error: result.error }, { status: 409 });
  return Response.json({
    synced: result.synced,
    newMeetings: result.newMeetings,
    alerts: result.alertList,
    drafts: result.drafts,
    error: result.error,
  });
}
