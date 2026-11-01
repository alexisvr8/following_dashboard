import { createThreadDraft } from "@/lib/integrations/gmail";
import {
  followupKey,
  getClientsFile,
  saveFollowup,
  type FollowupDraft,
  type FollowupKind,
} from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { getDraft } from "@/lib/utils/followup";

// Borradores de la cuenta: `kind` "meeting" (follow-up de la reunión) o "status" (actualización /
// seguimiento). PUT guarda la edición; POST además crea el draft en Gmail (dentro de `threadId`
// o como mail nuevo). Nunca envía: el envío se hace desde Gmail.

type Body = {
  kind?: FollowupKind;
  meetingId?: string;
  subject?: string;
  body?: string;
  to?: string[];
  threadId?: string | null;
};

async function resolve(rawId: string, input: Body) {
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === decodeURIComponent(rawId));
  const meeting = client?.meetings.find((m) => m.id === input.meetingId);
  if (!client || !meeting) return null;
  const kind: FollowupKind = input.kind === "status" ? "status" : "meeting";
  const { draft: base } = getDraft(kind, client, meeting, file.ownerEmail ?? null, await getSettings());
  const draft: FollowupDraft = {
    ...base,
    subject: typeof input.subject === "string" ? input.subject.slice(0, 300) : base.subject,
    body: typeof input.body === "string" ? input.body.slice(0, 20_000) : base.body,
    to: Array.isArray(input.to)
      ? input.to.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e))
      : base.to,
    updatedAt: new Date().toISOString(),
  };
  return { client, draft, key: followupKey(kind, meeting.id) };
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
  try {
    const created = await createThreadDraft({
      threadId: input.threadId ?? null,
      to: r.draft.to,
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

function gmailDraftUrl(c: { account: string | null; threadId: string | null; messageId: string }, threadId: string | null) {
  const auth = c.account ? `?authuser=${encodeURIComponent(c.account)}` : "";
  return threadId
    ? `https://mail.google.com/mail/${auth}#all/${c.threadId}`
    : `https://mail.google.com/mail/${auth}#drafts?compose=${c.messageId}`;
}
