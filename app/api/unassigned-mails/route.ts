import { scanUnassignedMails } from "@/lib/integrations/unassigned-mail";
import { syncClientsActivity } from "@/lib/integrations/client-activity";
import { getClientsFile, setClientActivity, updateClientProfile, type LinkedContact } from "@/lib/store/clients-store";
import { dismissUnassignedThread, getUnassignedMails, removeUnassignedThread } from "@/lib/store/unassigned-mail-store";

// Bandeja "Mails sin cuenta" (capa C). GET = bandeja. POST:
// - {action: "scan"}: escanea ahora (15 días).
// - {action: "assign", threadId, clientId, link?: "thread" | "sender" | "domain"}: el hilo queda ligado a la cuenta
//   (`profile.linkedThreads`); con sender/domain además se vincula como Exclusivo (`profile.linkedContacts`).
// - {action: "dismiss", threadId, ignore?: "sender" | "domain" | null}: no es de ninguna cuenta.

type Body = {
  action?: string;
  threadId?: string;
  clientId?: string;
  link?: "thread" | "sender" | "domain";
  ignore?: "sender" | "domain" | null;
};

export async function GET() {
  return Response.json(await getUnassignedMails());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  if (body.action === "scan") {
    const res = await scanUnassignedMails(await getClientsFile()).catch((e: Error) => ({ error: e.message }));
    if (!res) return Response.json({ error: "google_not_connected" }, { status: 409 });
    if ("error" in res) return Response.json(res, { status: 502 });
    return Response.json(res);
  }

  if (typeof body.threadId !== "string" || !body.threadId) return Response.json({ error: "thread_required" }, { status: 400 });
  const state = await getUnassignedMails();
  const item = state.items.find((i) => i.threadId === body.threadId);

  if (body.action === "dismiss") {
    const ignore = body.ignore === "sender" || body.ignore === "domain" ? body.ignore : null;
    await dismissUnassignedThread(body.threadId, ignore);
    return Response.json({ ok: true });
  }

  if (body.action === "assign") {
    if (!item) return Response.json({ error: "not_found" }, { status: 404 });
    const file = await getClientsFile();
    const client = file.clients.find((c) => c.id === body.clientId);
    if (!client) return Response.json({ error: "client_not_found" }, { status: 404 });
    const threads = (client.profile?.linkedThreads ?? []).filter((t) => t.threadId !== item.threadId);
    let contacts: LinkedContact[] | undefined;
    if (body.link === "sender" || body.link === "domain") {
      const value = body.link === "sender" ? item.from : item.from.split("@")[1];
      const others = (client.profile?.linkedContacts ?? []).filter((l) => l.value !== value);
      contacts = [...others, { value, shared: false }];
    }
    const updated = await updateClientProfile(client.id, {
      linkedThreads: [...threads, { threadId: item.threadId, subject: item.subject, at: new Date().toISOString() }],
      ...(contacts && { linkedContacts: contacts }),
    });
    if (!updated) return Response.json({ error: "client_not_found" }, { status: 404 });
    await removeUnassignedThread(item.threadId);
    // Trae enseguida ese hilo a la cuenta (interacción, "Por responder", trazabilidad) sin esperar la sync.
    try {
      const results = await syncClientsActivity([updated], file.ownerEmail ?? null, file.clients.map((c) => (c.id === updated.id ? updated : c)));
      const ok = (results ?? []).filter((r) => !r.error);
      if (ok.length) await setClientActivity(ok);
    } catch {
      // La próxima sync lo trae igual.
    }
    return Response.json({ ok: true, clientId: client.id });
  }

  return Response.json({ error: "invalid_action" }, { status: 400 });
}
