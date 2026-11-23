// Aprendizaje del mail de los lunes: compara el borrador que generó la app con lo que realmente envié (o programé)
// y arma la revisión punto por punto (modal "Del mail semanal" en /accionables). Sin IA: todo por reglas.
import { createHash } from "node:crypto";
import type { ClientRecord, WeeklyReviewItem } from "@/lib/store/clients-store";
import { accountActionables } from "@/lib/utils/actionables";
import { keywordSimilarity } from "@/lib/utils/mail-classify";

export interface MailListItem {
  title: string;
  owner: string | null;
  detail: string;
  /** Título + detalle, para comparar. */
  text: string;
}

/** Parecido mínimo para considerar que un punto enviado es el mismo que uno generado (aunque lo haya reescrito). */
const SAME_ITEM = 0.34;

/**
 * Texto propio de un mail enviado: sin la cita del mensaje anterior ni la firma (corta en "Saludos").
 * Une las líneas cortadas por el text/plain de Gmail dentro de cada párrafo / punto numerado.
 */
export function ownMailText(raw: string): string {
  let t = raw.replace(/\r/g, "");
  t = t.split(/\n(?:El .{5,160}escribió:|On .{5,160}wrote:|-{5,} ?Forwarded message)/)[0];
  t = t.split(/\n>/)[0];
  const lines = t.split("\n");
  const end = lines.findIndex((l) => /^\s*saludos[.!]?\s*$/i.test(l));
  const body = (end >= 0 ? lines.slice(0, end + 1) : lines).join("\n");
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

/** Puntos numerados ("1. **Título (Resp):** detalle" del borrador o "1. *Título (Resp):* detalle" de Gmail). */
export function parseMailItems(body: string): MailListItem[] {
  const text = ownMailText(body);
  const items: string[] = [];
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const start = line.match(/^\d{1,2}[.)]\s+(.*)$/);
    if (start) {
      if (current) items.push(current);
      current = start[1];
    } else if (current !== null && line && !/^saludos/i.test(line)) {
      // Continuación del punto (línea cortada o sub-viñeta) hasta la línea en blanco.
      current += ` ${line.replace(/^[-•*]\s+/, "")}`;
    } else if (current !== null) {
      items.push(current);
      current = null;
    }
  }
  if (current) items.push(current);
  return items.map((s) => {
    const clean = s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    // Título en negrita/cursiva terminado en ":" (con o sin el ":" adentro de los asteriscos).
    const m = clean.match(/^\*{1,2}\s*(.+?)\s*:?\s*\*{1,2}\s*:?\s*(.*)$/) ?? clean.match(/^([^:]{3,90}):\s+(.*)$/);
    let head = (m?.[1] ?? "").replace(/:$/, "").trim();
    let detail = (m ? m[2] : clean).replace(/\s*\*\((?:acordado|lograr)[^)]*\)\*\s*$/i, "").trim();
    if (!m) {
      head = clean.split(/[.:]/)[0].slice(0, 90);
      detail = clean;
    }
    const own = head.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const title = (own ? own[1] : head).trim();
    const owner = own ? own[2].trim() : null;
    return { title, owner, detail, text: `${title}: ${detail}`.trim() };
  });
}

/** Texto de un accionable vigente, comparable con un punto del mail. */
function stepText(step: string): string {
  return step.replace(/^\s*\[[^\]]+\]\s*/, "");
}

const sim = (a: MailListItem, b: MailListItem) =>
  Math.max(keywordSimilarity(a.title, b.title), keywordSimilarity(a.text, b.text));

/** Huella corta para ids estables de la revisión (no se duplican si se recalcula). */
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

/**
 * Ticket de cada punto del borrador: el guardado al crearlo (`weeklyItems`) o, si es de antes de esa marca, el
 * accionable vigente más parecido.
 */
function ticketsFor(client: ClientRecord, items: MailListItem[], stored?: string[]): (string | null)[] {
  if (stored?.length === items.length) return stored;
  const open = accountActionables(client).filter((a) => !a.done);
  return items.map((it) => {
    let best: { id: string; score: number } | null = null;
    for (const a of open) {
      const score = Math.max(keywordSimilarity(it.text, stepText(a.step)), keywordSimilarity(it.title, stepText(a.step)));
      if (!best || score > best.score) best = { id: a.id, score };
    }
    return best && best.score >= 0.3 ? best.id : null;
  });
}

/**
 * Diferencias entre el borrador y lo enviado → ítems de revisión. Puntos del borrador sin par en lo enviado =
 * "removed" (con su ticket, si todavía está abierto); puntos enviados sin par en el borrador = "added".
 */
export function weeklyReviewItems(
  client: ClientRecord,
  week: string,
  generatedBody: string,
  sentBody: string,
  storedTickets?: string[],
  now = new Date(),
): WeeklyReviewItem[] {
  const gen = parseMailItems(generatedBody);
  const sent = parseMailItems(sentBody);
  const tickets = ticketsFor(client, gen, storedTickets);
  const used = new Set<number>();
  const createdAt = now.toISOString();
  const out: WeeklyReviewItem[] = [];
  const open = new Set(accountActionables(client).filter((a) => !a.done).map((a) => a.id));

  gen.forEach((g, i) => {
    let best = -1;
    let score = 0;
    sent.forEach((s, j) => {
      if (used.has(j)) return;
      const v = sim(g, s);
      if (v > score) {
        score = v;
        best = j;
      }
    });
    if (best >= 0 && score >= SAME_ITEM) {
      used.add(best);
      return;
    }
    const ticketId = tickets[i];
    // Sin ticket o ya cerrado: no hay nada que decidir.
    if (!ticketId || !open.has(ticketId)) return;
    out.push({ id: `${week}:removed:${hash(ticketId)}`, week, kind: "removed", ticketId, title: g.title, detail: g.detail, owner: g.owner, createdAt });
  });
  sent.forEach((s, j) => {
    if (used.has(j) || s.text.length < 12) return;
    out.push({ id: `${week}:added:${hash(s.text)}`, week, kind: "added", title: s.title, detail: s.detail, owner: s.owner, createdAt });
  });
  return out;
}

/** Ítem de revisión para una cuenta a la que no le mandé el semanal (borrador borrado o reemplazado por otro mail). */
export function skippedReviewItem(week: string, clientName: string, how: "deleted" | "replaced", now = new Date()): WeeklyReviewItem {
  return {
    id: `${week}:skipped`,
    week,
    kind: "skipped",
    how,
    title: how === "deleted" ? `No enviaste el mail semanal a ${clientName}` : `Mandaste otro mail a ${clientName} en lugar del semanal`,
    createdAt: now.toISOString(),
  };
}

/** Mails semanales que realmente envié (texto real), del más reciente al más viejo. */
export function sentWeeklyBodies(client: ClientRecord, beforeKey?: string): { key: string; body: string }[] {
  return Object.entries(client.followups ?? {})
    .filter(([k, f]) => k.startsWith("week:") && (!beforeKey || k < beforeKey) && f.outcome?.body && f.outcome.state !== "replaced")
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, f]) => ({ key, body: f.outcome!.body! }));
}

/**
 * Ejemplos de estilo para la IA: los mails semanales enviados más recientes de OTRAS cuentas (los que más
 * reescribí primero), máx. `n`, recortados. Muestran cómo armo y redacto el mail aunque la cuenta sea nueva.
 */
export function weeklyStyleExamples(clients: ClientRecord[], excludeId: string | null, beforeKey: string, n = 3): string[] {
  const all = clients
    .filter((c) => c.id !== excludeId && c.status === "assigned")
    .flatMap((c) =>
      Object.entries(c.followups ?? {})
        .filter(([k, f]) => k.startsWith("week:") && k < beforeKey && f.outcome?.body && f.outcome.state !== "replaced")
        .map(([k, f]) => ({ k, body: f.outcome!.body!, edited: 1 - keywordSimilarity(f.body ?? "", f.outcome!.body!) })),
    );
  const latest = all.reduce((max, x) => (x.k > max ? x.k : max), "");
  return all
    .filter((x) => x.k === latest && parseMailItems(x.body).length > 0)
    .sort((a, b) => b.edited - a.edited)
    .slice(0, n)
    .map((x) => x.body.slice(0, 1400));
}

/** Ítem pendiente de la revisión semanal, listo para el modal (con la cuenta). */
export interface WeeklyReviewEntry {
  clientId: string;
  clientName: string;
  item: WeeklyReviewItem;
}

/** Revisión semanal sin resolver de las cuentas asignadas (las últimas 3 semanas), la más reciente primero. */
export function pendingWeeklyReview(clients: ClientRecord[], now = new Date()): WeeklyReviewEntry[] {
  const since = now.getTime() - 21 * 86_400_000;
  const order = { skipped: 0, removed: 1, added: 2 } as const;
  return clients
    .filter((c) => c.status === "assigned")
    .flatMap((c) =>
      Object.values(c.weeklyReview ?? {})
        .filter((i) => !i.state && Date.parse(i.createdAt) >= since)
        .map((item) => ({ clientId: c.id, clientName: c.name, item })),
    )
    .sort((a, b) => b.item.week.localeCompare(a.item.week) || a.clientName.localeCompare(b.clientName) || order[a.item.kind] - order[b.item.kind]);
}
