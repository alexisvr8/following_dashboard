// Qué hice con cada borrador del mail de los lunes: lo leo de Gmail (enviado o programado, con el texto real),
// lo guardo como referencia de estilo para la IA y armo la revisión punto por punto. Solo lectura en Gmail.
import { google, type gmail_v1 } from "googleapis";
import { getAuthorizedClient } from "@/lib/integrations/google-client";
import { setWeeklyOutcome, type ClientsFile, type WeeklyOutcome } from "@/lib/store/clients-store";
import { ownMailText, parseMailItems, skippedReviewItem, weeklyReviewItems } from "@/lib/utils/weekly-learning";

/** Borradores semanales de hasta 14 días: después ya no se revisan. */
const MAX_AGE_MS = 14 * 86_400_000;
/** Cada cuánto se vuelve a mirar Gmail (una llamada por borrador pendiente). */
const EVERY_MS = 30 * 60_000;
const g = globalThis as unknown as { __weeklyOutcomeAt?: number };

const decode = (d?: string | null) => (d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
function partText(p: gmail_v1.Schema$MessagePart | undefined, mime: string): string {
  if (!p) return "";
  if (p.mimeType === mime && p.body?.data) return decode(p.body.data);
  for (const c of p.parts ?? []) {
    const t = partText(c, mime);
    if (t) return t;
  }
  return "";
}
function messageText(m: gmail_v1.Schema$Message): string {
  const plain = partText(m.payload, "text/plain");
  if (plain) return plain;
  return partText(m.payload, "text/html")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/tr>|<\/div>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n1. ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export async function captureWeeklyOutcomes(file: ClientsFile, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force && g.__weeklyOutcomeAt && Date.now() - g.__weeklyOutcomeAt < EVERY_MS) return 0;
  g.__weeklyOutcomeAt = Date.now();
  const pending = file.clients.flatMap((c) =>
    Object.entries(c.followups ?? {})
      .filter(([k, f]) => k.startsWith("week:") && f.gmailDraftId && !f.outcome && f.draftCreatedAt)
      .filter(([, f]) => Date.now() - Date.parse(f.draftCreatedAt!) < MAX_AGE_MS)
      .map(([key, f]) => ({ client: c, key, f })),
  );
  if (!pending.length) return 0;
  const auth = await getAuthorizedClient();
  if (!auth) return 0;
  const gmail = google.gmail({ version: "v1", auth });
  // Programados: no tienen etiqueta en la API, solo aparecen con la búsqueda "in:scheduled".
  const scheduled = new Set(
    ((await gmail.users.messages.list({ userId: "me", q: "in:scheduled", maxResults: 200 }).catch(() => null))?.data.messages ?? []).map((m) => m.id!),
  );
  let saved = 0;
  for (const { client, key, f } of pending) {
    try {
      try {
        await gmail.users.drafts.get({ userId: "me", id: f.gmailDraftId!, format: "minimal" });
        continue; // sigue en borrador: todavía no decidiste
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== 404 && code !== 400) throw error;
      }
      const from = Date.parse(f.draftCreatedAt!) - 60_000;
      const thread = f.threadId ? await gmail.users.threads.get({ userId: "me", id: f.threadId, format: "full" }).catch(() => null) : null;
      const mine = (thread?.data.messages ?? [])
        .filter((m) => !m.labelIds?.includes("DRAFT"))
        .filter((m) => m.labelIds?.includes("SENT") || scheduled.has(m.id!))
        .filter((m) => scheduled.has(m.id!) || Number(m.internalDate) >= from)
        .map((m) => ({ m, body: ownMailText(messageText(m)) }))
        .map((x) => ({ ...x, items: parseMailItems(x.body).length }));
      // El semanal = el mío con más puntos numerados (si respondí otra cosa en el mismo hilo, no lo confunde).
      const pick = mine.sort((a, b) => b.items - a.items || Number(a.m.internalDate) - Number(b.m.internalDate))[0];
      const week = key.slice("week:".length);
      const now = new Date();
      let outcome: WeeklyOutcome;
      let review;
      if (!pick) {
        outcome = { state: "deleted", at: now.toISOString(), checkedAt: now.toISOString() };
        review = [skippedReviewItem(week, client.name, "deleted", now)];
      } else if (!pick.items && parseMailItems(f.body).length) {
        outcome = { state: "replaced", at: new Date(Number(pick.m.internalDate)).toISOString(), body: pick.body, checkedAt: now.toISOString() };
        review = [skippedReviewItem(week, client.name, "replaced", now)];
      } else {
        const state = scheduled.has(pick.m.id!) ? "scheduled" : "sent";
        outcome = { state, at: new Date(Number(pick.m.internalDate)).toISOString(), body: pick.body, checkedAt: now.toISOString() };
        // Borrador sin puntos numerados (plantilla vieja por reglas): solo queda como referencia, sin revisión.
        review = parseMailItems(f.body).length ? weeklyReviewItems(client, week, f.body, pick.body, f.weeklyItems, now) : [];
      }
      if (await setWeeklyOutcome(client.id, key, outcome, review)) saved++;
    } catch {
      // Se reintenta en la próxima pasada.
    }
  }
  return saved;
}
