import { getThreadMessages } from "@/lib/integrations/client-activity";
import { getClientsFile } from "@/lib/store/clients-store";

// Hilo de Gmail de una cuenta, para leerlo completo en el panel de Seguimiento del Dashboard.
// Solo lectura; únicamente hilos ya asociados al cliente por la sincronización de actividad.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; threadId: string }> }) {
  const { id, threadId } = await params;
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === decodeURIComponent(id));
  if (!client) return Response.json({ error: "not_found" }, { status: 404 });
  const a = client.activity;
  const known = new Set([
    ...(a?.threads ?? []).map((t) => t.threadId),
    ...(a?.recentMails ?? []).map((m) => m.threadId),
    ...(a?.lastMail ? [a.lastMail.threadId] : []),
    ...(a?.lastInboundMail ? [a.lastInboundMail.threadId] : []),
  ]);
  if (!known.has(threadId)) return Response.json({ error: "unknown_thread" }, { status: 404 });
  try {
    const messages = await getThreadMessages(threadId);
    if (!messages) return Response.json({ error: "google_not_connected" }, { status: 409 });
    return Response.json({ messages });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "gmail_error" }, { status: 502 });
  }
}
