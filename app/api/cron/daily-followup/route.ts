import { createThreadDraft } from "@/lib/integrations/gmail";
import { syncClientsActivity } from "@/lib/integrations/client-activity";
import { followupKey, getClientsFile, saveFollowup, setClientActivity } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { computeAlerts } from "@/lib/utils/followup-alerts";
import { buildStatusUpdate } from "@/lib/utils/followup";

// Cron diario (externo, días hábiles): sincroniza mails/reuniones de las cuentas asignadas,
// calcula alertas de seguimiento y, por cada cuenta alertada, deja UN borrador de actualización en
// Gmail (dentro del último hilo con referentes) por movimiento — nunca envía.
// `?drafts=0` solo sincroniza y devuelve las alertas.
export async function POST(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const withDrafts = new URL(req.url).searchParams.get("drafts") !== "0";
  const before = await getClientsFile();
  const assigned = before.clients.filter((c) => c.status === "assigned");
  const results = await syncClientsActivity(assigned, before.ownerEmail ?? null, before.clients);
  if (!results) return Response.json({ error: "google_not_connected" }, { status: 409 });
  await setClientActivity(results.filter((r) => !r.error));

  const file = await getClientsFile();
  const settings = await getSettings();
  const alerts = computeAlerts(file.clients, settings);
  const drafts: { clientId: string; ok: boolean; error?: string }[] = [];

  if (withDrafts) {
    for (const alert of alerts) {
      const client = file.clients.find((c) => c.id === alert.clientId)!;
      const meeting = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!meeting) continue;
      const key = followupKey("status", meeting.id);
      if (client.followups?.[key]?.autoFor === alert.lastMovementAt) continue; // ya generado
      const draft = buildStatusUpdate(client, meeting, file.ownerEmail ?? null, settings);
      if (!draft.to.length) continue;
      const threadId = client.activity?.threads[0]?.threadId ?? null;
      try {
        const created = await createThreadDraft({ threadId, to: draft.to, subject: draft.subject, body: draft.body });
        await saveFollowup(client.id, key, {
          ...draft,
          gmailDraftId: created.draftId,
          gmailMessageId: created.messageId,
          threadId: created.threadId,
          draftCreatedAt: new Date().toISOString(),
          autoFor: alert.lastMovementAt,
        });
        drafts.push({ clientId: client.id, ok: true });
      } catch (error) {
        drafts.push({ clientId: client.id, ok: false, error: (error as Error).message });
      }
    }
  }

  return Response.json({
    synced: results.filter((r) => !r.error).length,
    alerts: alerts.map((a) => ({ id: a.clientId, kind: a.kind, days: a.businessDays })),
    drafts,
  });
}
