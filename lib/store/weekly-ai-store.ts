import { getState, setState } from "@/lib/store/backend";

// Estado de la rutina del lunes con IA (`app_state.weekly_ai`, o `.data/weekly_ai.json`): análisis 07:00 y
// resumen a mí mismo 08:00. Clave propia para no pisarse con `sync_status`, que `runSync` reescribe.
export interface WeeklyAIState {
  /** Lunes (AAAA-MM-DD) del último análisis completo. */
  analysisWeek?: string;
  analysisAt?: string;
  /** Lunes del último resumen y su borrador en Gmail (se actualiza en vez de duplicarse). */
  digestWeek?: string;
  digestAt?: string;
  digestDraftId?: string;
  error?: string | null;
}

export async function getWeeklyAIState(): Promise<WeeklyAIState> {
  return (await getState<WeeklyAIState>("weekly_ai")) ?? {};
}

export async function saveWeeklyAIState(patch: Partial<WeeklyAIState>): Promise<WeeklyAIState> {
  const next = { ...(await getWeeklyAIState()), ...patch };
  await setState("weekly_ai", next);
  return next;
}
