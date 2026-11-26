// Minuta post-reunión con borrador en Gmail: si la enviaste desde Gmail (no desde la app), compara lo que salió con
// las líneas que generó la app (`minutaChanges`) y deja la revisión en el modal "De lo enviado" de /accionables
// (sacado → No corresponde sugerido; pasado a Hecho → cerrar; agregado → crear accionable). Solo lectura en Gmail.
import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/integrations/google-client";
import { messageText } from "@/lib/integrations/weekly-outcome";
import { setMinutaOutcome, type ClientsFile, type WeeklyReviewItem } from "@/lib/store/clients-store";
import { minutaChanges, parseMinutaLines } from "@/lib/utils/minuta-review";

/** Borradores de hasta 14 días: después ya no se revisan. */
const MAX_AGE_MS = 14 * 86_400_000;
/** Cada cuánto se vuelve a mirar Gmail (una llamada por borrador pendiente). */
const EVERY_MS = 30 * 60_000;
const g = globalThis as unknown as { __minutaOutcomeAt?: number };

const isMeetingKey = (k: string) => !/^(status|reminder|reply|week):/.test(k);

export async function captureMinutaOutcomes(file: ClientsFile, opts: { force?: boolean } = {}): Promise<number> {
  if (!opts.force && g.__minutaOutcomeAt && Date.now() - g.__minutaOutcomeAt < EVERY_MS) return 0;
  g.__minutaOutcomeAt = Date.now();
  const pending = file.clients
    .filter((c) => c.status === "assigned")
    .flatMap((c) =>
      Object.entries(c.followups ?? {})
        .filter(([k, f]) => isMeetingKey(k) && f.gmailDraftId && !f.sentAt && !f.minutaChecked && f.minutaItems?.length && f.draftCreatedAt)
        .filter(([, f]) => Date.now() - Date.parse(f.draftCreatedAt!) < MAX_AGE_MS)
        .map(([key, f]) => ({ client: c, key, f })),
    );
  if (!pending.length) return 0;
  const auth = await getAuthorizedClient();
  if (!auth) return 0;
  const gmail = google.gmail({ version: "v1", auth });
  let saved = 0;
  for (const { client, key, f } of pending) {
    try {
      try {
        await gmail.users.drafts.get({ userId: "me", id: f.gmailDraftId!, format: "minimal" });
        continue; // sigue en borrador
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== 404 && code !== 400) throw error;
      }
      const from = Date.parse(f.draftCreatedAt!) - 60_000;
      const thread = f.threadId ? await gmail.users.threads.get({ userId: "me", id: f.threadId, format: "full" }).catch(() => null) : null;
      // La minuta = el mío posterior al borrador con más líneas de accionables.
      const pick = (thread?.data.messages ?? [])
        .filter((m) => !m.labelIds?.includes("DRAFT") && m.labelIds?.includes("SENT") && Number(m.internalDate) >= from)
        .map((m) => ({ m, body: messageText(m) }))
        .map((x) => ({ ...x, lines: parseMinutaLines(x.body).length }))
        .filter((x) => x.lines > 0)
        .sort((a, b) => b.lines - a.lines || Number(a.m.internalDate) - Number(b.m.internalDate))[0];
      const now = new Date().toISOString();
      if (!pick) {
        // Borrado sin enviar (o enviado sin accionables): nada que validar.
        if (await setMinutaOutcome(client.id, key, { state: "deleted", at: now }, [])) saved++;
        continue;
      }
      const meeting = client.meetings.find((m) => m.id === f.meetingId);
      const day = (meeting?.date ?? f.draftCreatedAt!).slice(0, 10);
      const review: WeeklyReviewItem[] = minutaChanges(f.minutaItems!, pick.body).map((c) => ({
        id: `minuta:${f.meetingId}:${c.key}`,
        week: day,
        source: "minuta",
        meetingId: f.meetingId,
        kind: c.kind,
        ...(c.ticketId && { ticketId: c.ticketId }),
        title: c.title,
        ...(c.detail && { detail: c.detail }),
        owner: c.owner ?? null,
        createdAt: now,
      }));
      const at = new Date(Number(pick.m.internalDate)).toISOString();
      if (await setMinutaOutcome(client.id, key, { state: "sent", at }, review)) saved++;
    } catch {
      // Se reintenta en la próxima pasada.
    }
  }
  return saved;
}
