import { syncClientsActivity } from "@/lib/integrations/client-activity";
import { createThreadDraft, sendThreadMail } from "@/lib/integrations/gmail";
import {
  followupKey,
  getClientsFile,
  saveFollowup,
  setClientActivity,
  type ClientRecord,
  type ClientsFile,
  type FollowupDraft,
  type FollowupKind,
} from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { getDraft } from "@/lib/utils/followup";

// Borradores de la cuenta: `kind` "meeting" (follow-up de la reunión) o "status" (actualización /
// seguimiento). PUT guarda la edición; POST crea el draft en Gmail o, con `send: true`, envía el
// mail (dentro de `threadId` o como mail nuevo). Sin `send` nunca envía. PATCH trae los mails nuevos
// de la cuenta y regenera el borrador, descartando una edición guardada.

type Body = {
  kind?: FollowupKind;
  meetingId?: string;
  subject?: string;
  body?: string;
  to?: string[];
  cc?: string[];
  threadId?: string | null;
  send?: boolean;
};

async function resolve(rawId: string, input: Body) {
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === decodeURIComponent(rawId));
  const meeting = client?.meetings.find((m) => m.id === input.meetingId);
  if (!client || !meeting) return null;
  const kind: FollowupKind = input.kind === "status" ? "status" : "meeting";
  const { draft: base } = getDraft(kind, client, meeting, file.ownerEmail ?? null, await getSettings());
  const parseEmails = (list: string[]) =>
    list.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
  const draft: FollowupDraft = {
    ...base,
    subject: typeof input.subject === "string" ? input.subject.slice(0, 300) : base.subject,
    body: typeof input.body === "string" ? input.body.slice(0, 20_000) : base.body,
    to: Array.isArray(input.to) ? parseEmails(input.to) : base.to,
    cc: Array.isArray(input.cc) ? parseEmails(input.cc) : base.cc,
    threadId: input.threadId !== undefined ? input.threadId : base.threadId,
    updatedAt: new Date().toISOString(),
  };
  const key = followupKey(kind, meeting.id);
  const saved = client.followups?.[key];
  return { client, file, draft, key, pendingDraftId: saved?.sentAt ? undefined : saved?.gmailDraftId };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = (await request.json()) as Body;
  const before = await getClientsFile();
  const stale = before.clients.find((c) => c.id === decodeURIComponent(id));
  if (!stale) return Response.json({ error: "not_found" }, { status: 404 });
  const synced = await refreshActivity({ client: stale, file: before }).catch(() => false);

  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === stale.id);
  const meeting = client?.meetings.find((m) => m.id === input.meetingId);
  if (!client || !meeting) return Response.json({ error: "not_found" }, { status: 404 });
  const kind: FollowupKind = input.kind === "status" ? "status" : "meeting";
  const { generated } = getDraft(kind, client, meeting, file.ownerEmail ?? null, await getSettings());
  const key = followupKey(kind, meeting.id);
  const saved = client.followups?.[key];
  if (saved && !saved.sentAt) {
    // Conserva la referencia al draft de Gmail: enviar luego debe seguir reemplazándolo.
    await saveFollowup(client.id, key, {
      ...generated,
      gmailDraftId: saved.gmailDraftId,
      gmailMessageId: saved.gmailMessageId,
      draftCreatedAt: saved.draftCreatedAt,
    });
  }
  return Response.json({ draft: generated, synced });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolve(id, (await request.json()) as Body);
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  await saveFollowup(r.client.id, r.key, r.draft);
  return Response.json(r.draft);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = (await request.json()) as Body;
  const r = await resolve(id, input);
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  if (!r.draft.to.length) return Response.json({ error: "no_recipients" }, { status: 400 });
  if (input.send === true) {
    if (input.threadId === undefined) return Response.json({ error: "thread_required" }, { status: 400 });
    let sent: Awaited<ReturnType<typeof sendThreadMail>>;
    try {
      sent = await sendThreadMail({
        threadId: input.threadId,
        to: r.draft.to,
        cc: r.draft.cc,
        subject: r.draft.subject,
        body: r.draft.body,
        replacesDraftId: r.pendingDraftId,
      });
    } catch (error) {
      const msg = (error as Error).message;
      return Response.json({ error: msg }, { status: msg === "google_not_connected" ? 409 : 502 });
    }
    // El mail ya salió: ningún fallo posterior puede responder error (invitaría a reenviarlo).
    const sentAt = new Date().toISOString();
    await saveFollowup(r.client.id, r.key, {
      ...r.draft,
      gmailDraftId: undefined,
      gmailMessageId: sent.messageId,
      threadId: sent.threadId,
      sentAt,
      updatedAt: sentAt,
    }).catch(() => undefined);
    await refreshActivity(r).catch(() => undefined);
    return Response.json({ sentAt, gmailUrl: gmailDraftUrl({ ...sent }, sent.threadId) });
  }
  try {
    const created = await createThreadDraft({
      threadId: input.threadId ?? null,
      to: r.draft.to,
      cc: r.draft.cc,
      subject: r.draft.subject,
      body: r.draft.body,
    });
    const draft: FollowupDraft = {
      ...r.draft,
      gmailDraftId: created.draftId,
      gmailMessageId: created.messageId,
      threadId: created.threadId,
      draftCreatedAt: new Date().toISOString(),
    };
    await saveFollowup(r.client.id, r.key, draft);
    return Response.json({ ...draft, gmailUrl: gmailDraftUrl(created, input.threadId ?? null) });
  } catch (error) {
    const msg = (error as Error).message;
    return Response.json({ error: msg }, { status: msg === "google_not_connected" ? 409 : 502 });
  }
}

/** Trae enseguida el mail recién enviado, para que los borradores partan de él sin esperar la sync. */
async function refreshActivity({ client, file }: { client: ClientRecord; file: ClientsFile }) {
  const results = await syncClientsActivity([client], file.ownerEmail ?? null, file.clients);
  const ok = (results ?? []).filter((x) => !x.error);
  if (ok.length) await setClientActivity(ok);
  return ok.length > 0;
}

function gmailDraftUrl(c: { account: string | null; threadId: string | null; messageId: string }, threadId: string | null) {
  const auth = c.account ? `?authuser=${encodeURIComponent(c.account)}` : "";
  return threadId
    ? `https://mail.google.com/mail/${auth}#all/${c.threadId}`
    : `https://mail.google.com/mail/${auth}#drafts?compose=${c.messageId}`;
}
