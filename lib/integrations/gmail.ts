import { google } from "googleapis";
import { getAuthorizedClient } from "./google-client";

export async function findLatestThreadForEmail(contactEmail: string) {
  const auth = await getAuthorizedClient();
  if (!auth) return null;

  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.threads.list({
    userId: "me",
    q: `from:${contactEmail} OR to:${contactEmail}`,
    maxResults: 1,
  });

  const threadId = list.data.threads?.[0]?.id;
  if (!threadId) return null;

  const thread = await gmail.users.threads.get({ userId: "me", id: threadId });
  return thread.data;
}

/** Último hilo (excluye Gemini Notes) con cualquiera de los emails/dominio del cliente. */
export async function findLatestThreadIdForClient(
  domain: string | null,
  emails: string[],
): Promise<{ threadId: string; account: string | null } | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;

  const gmail = google.gmail({ version: "v1", auth });
  const targets = domain ? [`@${domain}`] : emails;
  if (!targets.length) return null;
  const or = targets.join(" OR ");
  const sender = process.env.GEMINI_NOTES_SENDER ?? "gemini-notes@google.com";
  const [list, profile] = await Promise.all([
    gmail.users.threads.list({
      userId: "me",
      q: `{from:(${or}) to:(${or}) cc:(${or})} -from:${sender}`,
      maxResults: 1,
    }),
    gmail.users.getProfile({ userId: "me" }),
  ]);
  const threadId = list.data.threads?.[0]?.id;
  return threadId ? { threadId, account: profile.data.emailAddress ?? null } : null;
}

export async function createDraftReply(threadId: string, to: string, body: string) {
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("google_not_connected");

  const gmail = google.gmail({ version: "v1", auth });

  const message = [`To: ${to}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\n");
  const raw = Buffer.from(message).toString("base64url");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw, threadId },
    },
  });

  return draft.data;
}

const encodeHeader = (s: string) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;

/**
 * Crea un draft en Gmail. Con `threadId` responde dentro de ese hilo (Re: + In-Reply-To/References
 * del último mensaje, para que Gmail lo enhebre); sin él, crea un mail nuevo con `subject`.
 */
export async function createThreadDraft(input: {
  threadId: string | null;
  to: string[];
  subject: string;
  body: string;
}): Promise<{ draftId: string; messageId: string; threadId: string | null; account: string | null }> {
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("google_not_connected");
  const gmail = google.gmail({ version: "v1", auth });

  let subject = input.subject;
  const extra: string[] = [];
  if (input.threadId) {
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: input.threadId,
      format: "metadata",
      metadataHeaders: ["Subject", "Message-ID", "References"],
    });
    const msgs = thread.data.messages ?? [];
    const get = (i: number, name: string) =>
      msgs[i]?.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
    const last = msgs.length - 1;
    const original = get(0, "Subject");
    if (original) subject = /^re:/i.test(original) ? original : `Re: ${original}`;
    const msgId = get(last, "Message-ID");
    if (msgId) {
      extra.push(`In-Reply-To: ${msgId}`, `References: ${[get(last, "References"), msgId].filter(Boolean).join(" ")}`);
    }
  }

  const raw = Buffer.from(
    [
      `To: ${input.to.join(", ")}`,
      `Subject: ${encodeHeader(subject)}`,
      ...extra,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body,
    ].join("\r\n"),
    "utf-8",
  ).toString("base64url");

  const [draft, profile] = await Promise.all([
    gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } },
    }),
    gmail.users.getProfile({ userId: "me" }),
  ]);
  return {
    draftId: draft.data.id!,
    messageId: draft.data.message?.id ?? "",
    threadId: draft.data.message?.threadId ?? input.threadId,
    account: profile.data.emailAddress ?? null,
  };
}
