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

// "- Status: Hecho|En curso|Pendiente|Stand By [⏳|✅] (dd/mm)" al final de un punto → "Status:" en negrita y el valor
// en negrita con color; emoji y fecha van después, sin color. Gmail/Outlook descartan <style> y clases: todo inline.
// Funciona también si lo escribís a mano en el editor.
// También sin "Status:" (mail post-reunión: " - Stand By ⏳" / " - Hecho (11/11)").
const STATUS_RE = /\s[—-]\s*(Status:\s*)?(Hecho|En curso|Pendiente|Stand By)(\s*[⏳✅]️?)?(\s*\([^)]*\))?\s*$/iu;
const STATUS_COLOR: Record<string, string> = {
  hecho: "#188038",
  "en curso": "#E37400",
  pendiente: "#D93025",
  "stand by": "#5F6368",
};
const STATUS_LABEL: Record<string, string> = { hecho: "Hecho", "en curso": "En curso", pendiente: "Pendiente", "stand by": "Stand By" };

const MAIL_STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124;";
const P_STYLE = "margin:0 0 12px 0;";
/** Párrafo precedido por 2+ líneas en blanco (cierre, "Saludos"): un espacio más. */
const P_GAP_STYLE = "margin:24px 0 12px 0;";
const H_STYLE = "margin:18px 0 6px 0;";
/** Subtítulo pegado a otro título ("Accionables…" → "De nuestro lado"): sin el salto grande. */
const SUBH_STYLE = "margin:6px 0 6px 0;";
const UL_STYLE = "margin:0 0 12px 0;padding-left:22px;";
const LI_STYLE = "margin:0 0 6px 0;";

/** Viñetas del borrador: "• " (pendiente / lista) y "✓ " (ya hecho) van igual, como lista. */
const BULLET_RE = /^\s*[•✓]\s+(.*)$/;
/** Lista numerada ("1. texto"): va como <ol>. */
const NUMBERED_RE = /^\s*\d{1,2}[.)]\s+(.*)$/;
/**
 * Título de sección: línea corta que termina en ":" ("Decisiones acordadas:"). Una frase con coma seguida de
 * minúscula ("Para mantener ese cronograma, necesitamos…:") es texto que presenta una lista, no un título.
 */
const isHeading = (line: string) =>
  line.length <= 90 &&
  /:\s*$/.test(line) &&
  !BULLET_RE.test(line) &&
  !NUMBERED_RE.test(line) &&
  !/,\s+\p{Ll}/u.test(line) &&
  // Dos oraciones ("Gracias por el espacio del martes. Te dejo un resumen…:") = apertura del mail, no título.
  !/[.!?]\s+\S/.test(line);
const OL_STYLE = "margin:0 0 12px 0;padding-left:22px;";

/** Texto escapado con "**negrita**" → <strong> y "*cursiva*" → <em>. */
const inline = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");

function formatLine(line: string): string {
  const m = line.match(STATUS_RE);
  if (!m) return inline(line);
  const head = inline(line.slice(0, m.index));
  const key = m[2].toLowerCase();
  const emoji = m[3] ? ` ${m[3].trim()}` : "";
  const date = m[4] ? ` ${escapeHtml(m[4].trim())}` : "";
  const label = m[1] ? "<strong>Status:</strong> " : "";
  return `${head} - ${label}<strong style="color:${STATUS_COLOR[key]}">${STATUS_LABEL[key]}</strong>${emoji}${date}`;
}

/** Títulos que van solo en negrita; el resto ("Accionables de…", "Ya avanzamos con") en negrita y subrayado. */
const PLAIN_HEADING = /^(\p{Extended_Pictographic}\uFE0F?\s*)?(Puntos importantes|Lo que charlamos|Próximos pasos|Accionables|Ya avanzamos con)$/iu;

// Sección "🚀 Accionables:" del mail post-reunión → lista por lado (título en negrita, responsable y status con color),
// subtítulos "De parte de X:" / "De nuestro lado (Xtract):".
const ACTIONABLES_HEADING = /^(\p{Extended_Pictographic}\uFE0F?\s*)?Accionables$/iu;
const BIG_H_STYLE = "margin:24px 0 10px 0;font-size:18px;line-height:1.3;";
/** "Título: descripción. (Responsable) - Status: X ⏳ (dd/mm)" → partes; null si se editó y ya no tiene ese formato. */
const ROW_RE = /^([^:]{2,80}):\s+(.*?)\s*\(([^()]+)\)\s*[—-]\s*Status:\s*(Hecho|En curso|Pendiente|Stand By)(\s*[⏳✅]️?)?(\s*\([^)]*\))?\s*$/iu;

/** Lista (no tabla: en Gmail borrar un punto de una tabla deja la fila vacía). Título en negrita + detalle + (Responsable) - Status. */
function actionablesList(segments: { label: string; rows: string[] }[]): string {
  return segments
    .filter((seg) => seg.rows.length)
    .map((seg) => {
      const items = seg.rows.map((text) => {
        const m = text.match(ROW_RE);
        if (!m) return `<li style="${LI_STYLE}">${formatLine(text)}</li>`;
        const key = m[4].toLowerCase();
        const status = `<strong>Status:</strong> <strong style="color:${STATUS_COLOR[key]}">${STATUS_LABEL[key]}</strong>${m[5] ? ` ${m[5].trim()}` : ""}${m[6] ? ` ${escapeHtml(m[6].trim())}` : ""}`;
        return `<li style="${LI_STYLE}"><strong>${inline(m[1].trim())}:</strong> ${inline(m[2].trim())} (${escapeHtml(m[3].trim())}) - ${status}</li>`;
      });
      const label = seg.label ? `<p style="${SUBH_STYLE}"><strong><span style="text-decoration:underline">${escapeHtml(seg.label)}</span>:</strong></p>` : "";
      return `${label}<ul style="${UL_STYLE}">${items.join("")}</ul>`;
    })
    .join("");
}

/**
 * Texto del borrador → HTML compacto con estilos inline: cada línea un <p>, títulos en negrita y subrayados + ":", viñetas
 * (• y ✓) en <ul>, "1. " en <ol>, "**texto**" en negrita. Las líneas en blanco solo separan bloques: no generan <br> ni párrafos vacíos.
 */
export function bodyToHtml(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let listTag: "ul" | "ol" = "ul";
  let prevHeading = false;
  let blanks = 0;
  const flush = () => {
    if (list.length) {
      const style = listTag === "ol" ? OL_STYLE : UL_STYLE;
      out.push(`<${listTag} style="${style}">${list.map((l) => `<li style="${LI_STYLE}">${l}</li>`).join("")}</${listTag}>`);
    }
    list = [];
  };
  const push = (tag: "ul" | "ol", text: string) => {
    if (listTag !== tag) flush();
    listTag = tag;
    if (text) list.push(formatLine(text));
    prevHeading = false;
  };
  // Dentro de "🚀 Accionables:": franjas por lado hasta el próximo título con emoji o un párrafo.
  let table: { label: string; rows: string[] }[] | null = null;
  const closeTable = () => {
    if (table) out.push(actionablesList(table));
    table = null;
  };
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      blanks++;
      continue;
    }
    const gap = blanks >= 2;
    blanks = 0;
    if (table) {
      const t = line.trim();
      const item = t.match(BULLET_RE);
      if (item) {
        if (!table.length) table.push({ label: "", rows: [] });
        if (item[1].trim()) table.at(-1)!.rows.push(item[1].trim());
        continue;
      }
      if (isHeading(t) && !/^\p{Extended_Pictographic}/u.test(t)) {
        table.push({ label: t.replace(/\s*:\s*$/, ""), rows: [] });
        continue;
      }
      closeTable();
      prevHeading = false;
    }
    const bullet = line.match(BULLET_RE);
    if (bullet) {
      push("ul", bullet[1].trim());
      continue;
    }
    const numbered = line.match(NUMBERED_RE);
    if (numbered) {
      push("ol", numbered[1].trim());
      continue;
    }
    flush();
    if (isHeading(line.trim()) && ACTIONABLES_HEADING.test(line.trim().replace(/\s*:\s*$/, ""))) {
      out.push(`<p style="${BIG_H_STYLE}"><strong>${escapeHtml(line.trim().replace(/\s*:\s*$/, ""))}</strong></p>`);
      table = [];
      continue;
    }
    if (isHeading(line.trim())) {
      const raw = line.trim().replace(/\s*:\s*$/, "");
      const title = escapeHtml(raw);
      const text = PLAIN_HEADING.test(raw) ? title : `<span style="text-decoration:underline">${title}</span>`;
      out.push(`<p style="${prevHeading ? SUBH_STYLE : H_STYLE}"><strong>${text}:</strong></p>`);
      prevHeading = true;
    } else {
      out.push(`<p style="${gap ? P_GAP_STYLE : P_STYLE}">${formatLine(line.trim())}</p>`);
      prevHeading = false;
    }
  }
  flush();
  closeTable();
  return normalizeHtml(out.join(""));
}

/** Red de seguridad: sin <br> repetidos ni párrafos/divs vacíos (p. ej. si el texto trae HTML pegado). */
export function normalizeHtml(html: string): string {
  return html
    .replace(/(<br\s*\/?>\s*){2,}/gi, "<br>")
    .replace(/<(p|div)(\s[^>]*)?>\s*(<br\s*\/?>|&nbsp;|\s)*\s*<\/\1>/gi, "")
    .trim();
}

/** Texto plano del mail: viñetas con "- ", una línea en blanco entre secciones (dos antes del cierre), sin espacios al final. */
export function bodyToPlain(body: string): string {
  return body
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*[•✓]\s+/, "- ").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1$2").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
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
  /** HTML propio (p. ej. el resumen semanal con tarjetas): reemplaza a `bodyToHtml(body)` y va sin firma. */
  html?: string;
}): string {
  const boundary = `xtract_${randomUUID().replace(/-/g, "")}`;
  const part = (type: string, content: string) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(content, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  const signature = input.html ? "" : input.signatureHtml?.trim();
  const text = bodyToPlain(input.body);
  const plain = signature ? `${text}\n\n-- \n${stripHtml(signature).trim()}` : text;
  const html = `<div dir="ltr" style="${MAIL_STYLE}">${input.html ?? bodyToHtml(input.body)}${
    // Sin la clase `gmail_signature`: con ella Gmail la trata como firma repetida y la esconde tras "…".
    // El último <p> ("Saludos") ya deja 12px: la firma va pegada, sin <br> extra.
    // Gmail además esconde lo que se repite igual en mensajes anteriores del hilo (la firma de cada mail): un
    // marcador invisible y único al principio y al final hace que nunca coincida con la de mails previos.
    // El oculto (display:none) Gmail lo descarta al comparar, así que al final va también uno que cuenta como texto
    // (1px, color del fondo): el bloque final ya nunca es igual al de los mails previos y la firma no se recorta.
    signature ? `<div dir="ltr">${uniqueMark()}${signature}${uniqueMark()}</div>${tailMark()}` : ""
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

/** Texto oculto distinto en cada mail (no se ve ni ocupa lugar) para que Gmail no recorte la firma como repetida. */
const uniqueMark = () =>
  `<span style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;color:transparent">${randomUUID().slice(0, 8)}</span>`;

/** Marcador final distinto en cada mail que Gmail sí cuenta como texto (no se distingue a simple vista). */
const tailMark = () =>
  `<div style="color:#ffffff;font-size:1px;line-height:1px;mso-hide:all" aria-hidden="true">${randomUUID().slice(0, 8)}</div>`;

type MailInput = { threadId: string | null; to: string[]; cc?: string[]; subject: string; body: string; html?: string };

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
    // Hilo que solo tiene el borrador (mail nuevo auto-fijado, todavía sin enviar): es el primer mail, sin "Re:".
    else if (!msgs.length) subject = subject.replace(/^\s*re:\s*/i, "");
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
 * Qué pasó con un borrador que dejó la app: sigue en Gmail, se envió desde Gmail (hay un mail mío en su hilo
 * desde que se creó) o se borró. Sirve para no volver a crearlo cuando ya no está.
 */
export async function draftFate(
  draftId: string,
  threadId: string | null | undefined,
  createdAt: string | undefined,
): Promise<{ state: "exists" } | { state: "sent"; at: string } | { state: "deleted" }> {
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("google_not_connected");
  const gmail = google.gmail({ version: "v1", auth });
  try {
    await gmail.users.drafts.get({ userId: "me", id: draftId, format: "minimal" });
    return { state: "exists" };
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 404 && code !== 400) throw error;
  }
  if (threadId) {
    const thread = await gmail.users.threads.get({ userId: "me", id: threadId, format: "minimal" });
    const from = createdAt ? Date.parse(createdAt) - 60_000 : 0;
    const sentAt = (thread.data.messages ?? [])
      .filter((m) => m.labelIds?.includes("SENT") && !m.labelIds.includes("DRAFT"))
      .map((m) => Number(m.internalDate))
      .filter((t) => t >= from)
      .sort((a, b) => b - a)[0];
    if (sentAt) return { state: "sent", at: new Date(sentAt).toISOString() };
  }
  return { state: "deleted" };
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
