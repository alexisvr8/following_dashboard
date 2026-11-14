import { createThreadDraft } from "@/lib/integrations/gmail";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { getWeeklyAIState, saveWeeklyAIState } from "@/lib/store/weekly-ai-store";
import { mondayKey } from "@/lib/utils/account-analysis";
import { buildWeeklyDigest } from "@/lib/utils/weekly-digest";

// Resumen del lunes como BORRADOR en Gmail dirigido a mí (`ownerEmail`): nunca se envía solo ni va al cliente.
// Si se corre de nuevo la misma semana, actualiza el mismo borrador.
export async function createWeeklyDigestDraft(now = new Date()): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const [file, settings, state] = await Promise.all([getClientsFile(), getSettings(), getWeeklyAIState()]);
  if (!file.ownerEmail) return { ok: false, error: "sin_owner_email" };
  const week = mondayKey(now);
  const digest = buildWeeklyDigest(file.clients, settings, now, process.env.APP_URL ?? null);
  try {
    const draft = await createThreadDraft(
      { threadId: null, to: [file.ownerEmail], subject: digest.subject, body: digest.body },
      state.digestWeek === week ? state.digestDraftId : undefined,
    );
    await saveWeeklyAIState({ digestWeek: week, digestAt: new Date().toISOString(), digestDraftId: draft.draftId, error: null });
    return { ok: true, draftId: draft.draftId };
  } catch (error) {
    const message = (error as Error).message || "error";
    await saveWeeklyAIState({ error: `digest: ${message}` });
    return { ok: false, error: message };
  }
}
