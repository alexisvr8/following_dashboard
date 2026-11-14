import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/integrations/google-client";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { collectAccountThreads } from "@/lib/integrations/account-mails";
import { sharedExternals } from "@/lib/integrations/client-activity";
import { mapLimit } from "@/lib/integrations/gemini-mail";
import { generateAccountAnalysis } from "@/lib/llm/account-analysis";
import { aiEnabled, postMeetingModel } from "@/lib/llm/postmeeting";
import { getClientsFile, markAnalysisFailed, setAccountAnalysis, type ClientRecord } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { analysisWindow, buildAnalysisInput, estimatesFromAnalysis, mondayKey, newItemsFromAnalysis, sanitizeRefs } from "@/lib/utils/account-analysis";
import { nextMeetings } from "@/lib/utils/deadlines";

// Análisis semanal con IA de las cuentas asignadas (lunes 07:00 desde el scheduler, o a mano desde
// `POST /api/analysis`): por cuenta lee la última minuta, el tablero y TODA la trazabilidad de mails del período
// (`collectAccountThreads`), llama a Claude y guarda `client.analysis`; lo nuevo que detecta entra al tablero.
// Una llamada por cuenta y por semana (salvo `force`). Nunca envía mails al cliente ni tilda accionables.

const CONCURRENCY = 2;

export interface AnalyzeResult {
  ok: boolean;
  error?: string;
  week: string;
  analyzed: number;
  skipped: number;
  failed: number;
  added: number;
  accounts: { id: string; name: string; ok: boolean; skipped?: boolean; added?: number; error?: string }[];
}

const g = globalThis as unknown as { __analysisRunning?: Promise<AnalyzeResult> | null };

/** Evita dos análisis simultáneos (scheduler + botón): el segundo espera al primero. */
export async function analyzeAccounts(opts: { ids?: string[]; force?: boolean; now?: Date } = {}): Promise<AnalyzeResult> {
  if (g.__analysisRunning) return g.__analysisRunning;
  g.__analysisRunning = run(opts);
  try {
    return await g.__analysisRunning;
  } finally {
    g.__analysisRunning = null;
  }
}

async function run({ ids, force = false, now = new Date() }: { ids?: string[]; force?: boolean; now?: Date }): Promise<AnalyzeResult> {
  const week = mondayKey(now);
  const empty: AnalyzeResult = { ok: false, week, analyzed: 0, skipped: 0, failed: 0, added: 0, accounts: [] };
  if (!aiEnabled()) return { ...empty, error: "sin_anthropic_api_key" };
  const auth = await getAuthorizedClient();
  if (!auth) return { ...empty, error: "google_not_connected" };
  const gmail = google.gmail({ version: "v1", auth });

  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const wanted = ids && new Set(ids);
  const targets = file.clients.filter((c) => c.status === "assigned" && (!wanted || wanted.has(c.id)));
  const events = await listEventsBetween(now, new Date(now.getTime() + 21 * 86_400_000)).catch(() => null);
  const upcoming = nextMeetings(file.clients, events, now);
  const shared = sharedExternals(file.clients);
  const ownerEmail = file.ownerEmail ?? null;

  const accounts = await mapLimit(targets, CONCURRENCY, async (client: ClientRecord): Promise<AnalyzeResult["accounts"][number]> => {
    const base = { id: client.id, name: client.name };
    if (!force && client.analysis?.week === week) return { ...base, ok: true, skipped: true };
    try {
      const { since, basis } = analysisWindow(client, now);
      const mails = await collectAccountThreads(gmail, client, ownerEmail, shared, since.getTime());
      const { input, refs, refTexts, rewritable, existing } = buildAnalysisInput(client, settings, mails.threads, now, upcoming.get(client.id) ?? null);
      const output = sanitizeRefs((await generateAccountAnalysis(input)).output, refs, rewritable);
      const added = await setAccountAnalysis(
        client.id,
        {
          week,
          generatedAt: new Date().toISOString(),
          model: postMeetingModel(),
          basis,
          since: since.toISOString(),
          threadsRead: mails.threads.length,
          mailsRead: mails.messages,
          ...(mails.truncated && { truncated: true }),
          refs,
          refTexts,
          output,
        },
        newItemsFromAnalysis(output, settings, since),
        existing,
        estimatesFromAnalysis(output, refs),
      );
      return { ...base, ok: true, added: added?.length ?? 0 };
    } catch (error) {
      const message = (error as Error).message || "error";
      await markAnalysisFailed(client.id, message).catch(() => undefined);
      return { ...base, ok: false, error: message };
    }
  });

  return {
    ok: accounts.every((a) => a.ok),
    week,
    analyzed: accounts.filter((a) => a.ok && !a.skipped).length,
    skipped: accounts.filter((a) => a.skipped).length,
    failed: accounts.filter((a) => !a.ok).length,
    added: accounts.reduce((n, a) => n + (a.added ?? 0), 0),
    accounts,
  };
}
