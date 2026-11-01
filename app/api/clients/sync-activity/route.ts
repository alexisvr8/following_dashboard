import { syncClientsActivity } from "@/lib/integrations/client-activity";
import { getClientsFile, setClientActivity } from "@/lib/store/clients-store";

// Actualiza actividad (último mail real de referentes, hilos, última reunión en Calendar,
// follow-up enviado) de clientes asignados y no asignados. Body opcional `{ ids: string[] }`.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const file = await getClientsFile();
  const targets = file.clients.filter((c) =>
    body.ids?.length ? body.ids.includes(c.id) : c.status === "assigned" || c.status === "unassigned",
  );
  try {
    const results = await syncClientsActivity(targets, file.ownerEmail ?? null, file.clients);
    if (!results) return Response.json({ error: "google_not_connected" }, { status: 409 });
    const ok = results.filter((r) => !r.error);
    await setClientActivity(ok);
    return Response.json({
      synced: ok.length,
      failed: results.length - ok.length,
      withMail: ok.filter((r) => r.activity.lastInboundMail).length,
      followupsDetected: ok.reduce((n, r) => n + r.autoDoneTicketIds.length, 0),
      errors: results.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error })),
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
