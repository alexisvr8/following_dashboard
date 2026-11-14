import { createThreadDraft, sendThreadMail } from "@/lib/integrations/gmail";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { getWeeklyAIState, saveWeeklyAIState } from "@/lib/store/weekly-ai-store";
import { mondayKey } from "@/lib/utils/account-analysis";
import { buildWeeklyDigest } from "@/lib/utils/weekly-digest";

// Resumen de la semana dirigido SOLO a mí (`ownerEmail`), nunca a un cliente. Por defecto se ENVÍA (llega a la
// bandeja de entrada); `WEEKLY_DIGEST=draft` lo deja como borrador. Una vez por semana: si ya salió, no se repite
// (`force` lo reenvía); en modo borrador, se actualiza el mismo borrador.
export const digestMode = (): "send" | "draft" => (process.env.WEEKLY_DIGEST === "draft" ? "draft" : "send");

export async function deliverWeeklyDigest(
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; mode: "send" | "draft"; skipped?: boolean; error?: string }> {
  const mode = digestMode();
  const [file, settings, state] = await Promise.all([getClientsFile(), getSettings(), getWeeklyAIState()]);
  const to = file.ownerEmail?.toLowerCase();
  if (!to) return { ok: false, mode, error: "sin_owner_email" };
  const week = mondayKey(now);
  if (!opts.force && mode === "send" && state.digestWeek === week && state.digestSentAt) return { ok: true, mode, skipped: true };
  const digest = buildWeeklyDigest(file.clients, settings, now, process.env.APP_URL ?? null);
  const input = { threadId: null, to: [to], subject: digest.subject, body: digest.body, html: digest.html };
  try {
    if (mode === "send") {
      const sent = await sendThreadMail({ ...input, ...(state.digestWeek === week && state.digestDraftId && { replacesDraftId: state.digestDraftId }) });
      await saveWeeklyAIState({ digestWeek: week, digestAt: new Date().toISOString(), digestSentAt: new Date().toISOString(), digestMessageId: sent.messageId, digestDraftId: undefined, error: null });
    } else {
      const draft = await createThreadDraft(input, state.digestWeek === week ? state.digestDraftId : undefined);
      await saveWeeklyAIState({ digestWeek: week, digestAt: new Date().toISOString(), digestDraftId: draft.draftId, error: null });
    }
    return { ok: true, mode };
  } catch (error) {
    const message = (error as Error).message || "error";
    await saveWeeklyAIState({ error: `digest: ${message}` });
    return { ok: false, mode, error: message };
  }
}
