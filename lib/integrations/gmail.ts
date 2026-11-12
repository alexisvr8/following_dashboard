import { randomUUID } from "crypto";
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "./google-client";
import { stripHtml } from "./gemini-mail";

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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "- Status: Hecho|Pendiente (dd/mm)" al final de un punto → "Status:" en negrita; "Hecho" en negrita verde (Gmail
// conserva estilos inline). Funciona también si lo escribís a mano en el editor.
const STATUS_RE = /\s[—-]\s*Status:\s*(Hecho|Pendiente)(\s*\([^)]*\))?\s*$/i;
const DONE_GREEN = "#188038";

function formatLine(line: string): string {
  const m = line.match(STATUS_RE);
  if (!m) return escapeHtml(line);
  const head = escapeHtml(line.slice(0, m.index));
  const done = /^hecho$/i.test(m[1]);
  const value = done ? `<b style="color:${DONE_GREEN}">Hecho</b>` : "Pendiente";
  return `${head} - <b>Status:</b> ${value}${m[2] ? escapeHtml(m[2]) : ""}`;
}

/** Texto del borrador → HTML como el del redactor de Gmail: cada línea un div, "• " en listas reales. */
export function bodyToHtml(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const line of body.replace(/\r/g, "").split("\n")) {
    const bullet = line.match(/^\s*•\s+(.*)$/);
    if (bullet) {
      list.push(formatLine(bullet[1]));
      continue;
    }
    flush();
    out.push(line.trim() ? `<div>${formatLine(line)}</div>` : "<div><br></div>");
  }
  flush();
  return out.join("");
}

/**
 * Mensaje como el que arma Gmail: multipart/alternative con HTML (el texto fluye al ancho de la
 * ventana) y texto plano de respaldo. Base64 evita cortes de línea en el contenido al transportarlo.
 */
export function buildMimeMessage(input: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  signatureHtml?: string;
  extraHeaders?: string[];
}): string {
  const boundary = `xtract_${randomUUID().replace(/-/g, "")}`;
  const part = (type: string, content: string) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(content, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  const signature = input.signatureHtml?.trim();
  const plain = signature ? `${input.body}\n\n-- \n${stripHtml(signature).trim()}` : input.body;
  const html = `<div dir="ltr">${bodyToHtml(input.body)}${
    // Sin la clase `gmail_signature`: con ella Gmail la trata como firma repetida y la esconde tras "…".
    signature ? `<div><br></div><div dir="ltr">${signature}</div>` : ""
  }</div>`;
  return [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.extraHeaders ?? []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...part("text/plain", plain),
    ...part("text/html", html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

type MailInput = { threadId: string | null; to: string[]; cc?: string[]; subject: string; body: string };

/** La API no agrega la firma de Gmail como lo hace el redactor: se toma de la cuenta principal. */
async function primarySignature(gmail: gmail_v1.Gmail): Promise<string> {
  try {
    const { data } = await gmail.users.settings.sendAs.list({ userId: "me" });
    return data.sendAs?.find((s) => s.isPrimary)?.signature ?? "";
  } catch {
    return "";
  }
}

/** Con `threadId` responde dentro de ese hilo (Re: + In-Reply-To/References); sin él, mail nuevo con `subject`. */
async function composeRaw(gmail: gmail_v1.Gmail, input: MailInput): Promise<string> {
  let subject = input.subject;
  const extraHeaders: string[] = [];
  if (input.threadId) {
    const thread = await gmail.users.threads.get({
      userId: "me",
      id: input.threadId,
      format: "metadata",
      metadataHeaders: ["Subject", "Message-ID", "References"],
    });
    // Un borrador sin enviar del hilo no sirve de referencia: el destinatario nunca lo recibió.
    const msgs = (thread.data.messages ?? []).filter((m) => !m.labelIds?.includes("DRAFT"));
    const get = (i: number, name: string) =>
      msgs[i]?.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
    const last = msgs.length - 1;
    const original = get(0, "Subject");
    if (original) subject = /^re:/i.test(original) ? original : `Re: ${original}`;
    const msgId = get(last, "Message-ID");
    if (msgId) {
      extraHeaders.push(`In-Reply-To: ${msgId}`, `References: ${[get(last, "References"), msgId].filter(Boolean).join(" ")}`);
    }
  }
  const mime = buildMimeMessage({ ...input, subject, signatureHtml: await primarySignature(gmail), extraHeaders });
  return Buffer.from(mime, "utf-8").toString("base64url");
}

/**
 * Crea un draft en Gmail (no envía). Con `replaceDraftId` actualiza ese borrador (mismo mail, contenido nuevo)
 * en vez de dejar dos; si ya no existe (lo enviaste o borraste en Gmail) crea uno nuevo.
 */
export async function createThreadDraft(
  input: MailInput,
  replaceDraftId?: string,
): Promise<{ draftId: string; messageId: string; threadId: string | null; account: string | null; updated: boolean }> {
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("google_not_connected");
  const gmail = google.gmail({ version: "v1", auth });
  const raw = await composeRaw(gmail, input);
  const requestBody = { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } };
  const profile = gmail.users.getProfile({ userId: "me" });
  let draft: gmail_v1.Schema$Draft | null = null;
  let updated = false;
  if (replaceDraftId) {
    try {
      draft = (await gmail.users.drafts.update({ userId: "me", id: replaceDraftId, requestBody })).data;
      updated = true;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 404 && code !== 400) throw error;
    }
  }
  draft ??= (await gmail.users.drafts.create({ userId: "me", requestBody })).data;
  return {
    draftId: draft.id!,
    messageId: draft.message?.id ?? "",
    threadId: draft.message?.threadId ?? input.threadId,
    account: (await profile).data.emailAddress ?? null,
    updated,
  };
}

/**
 * Envía el mail (en el hilo elegido o como mail nuevo). `replacesDraftId`: borrador en Gmail de este
 * mismo mensaje, se descarta para que no quede pendiente y se envíe dos veces.
 */
export async function sendThreadMail(
  input: MailInput & { replacesDraftId?: string },
): Promise<{ messageId: string; threadId: string | null; account: string | null }> {
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("google_not_connected");
  const gmail = google.gmail({ version: "v1", auth });
  const raw = await composeRaw(gmail, input);
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
  });
  // Ya salió: nada de lo que sigue puede reportarse como error de envío.
  if (input.replacesDraftId) {
    await gmail.users.drafts.delete({ userId: "me", id: input.replacesDraftId }).catch(() => undefined);
  }
  const profile = await gmail.users.getProfile({ userId: "me" }).catch(() => null);
  return {
    messageId: sent.data.id ?? "",
    threadId: sent.data.threadId ?? input.threadId,
    account: profile?.data.emailAddress ?? null,
  };
}
