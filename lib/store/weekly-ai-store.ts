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
  /** Cuándo se envió el resumen de esa semana (modo envío) y el id del mensaje. */
  digestSentAt?: string;
  digestMessageId?: string;
  error?: string | null;
  /** Quién arrancó cada tarea de la semana (se marca al EMPEZAR): otro equipo no la repite mientras siga vigente. */
  claims?: Partial<Record<WeeklyTask, WeeklyClaim>>;
}

export type WeeklyTask = "analysis" | "drafts" | "digest" | "friday";
export interface WeeklyClaim {
  week: string;
  by: string;
  host: string;
  at: string;
}

export async function getWeeklyAIState(): Promise<WeeklyAIState> {
  return (await getState<WeeklyAIState>("weekly_ai")) ?? {};
}

export async function saveWeeklyAIState(patch: Partial<WeeklyAIState>): Promise<WeeklyAIState> {
  const next = { ...(await getWeeklyAIState()), ...patch };
  await setState("weekly_ai", next);
  return next;
}

/**
 * Reserva una tarea del lunes antes de correrla. `false` si otro proceso la reservó para la misma semana hace menos
 * de `ttlMs` (sigue corriendo o recién terminó); pasado ese plazo sin marcarse hecha, se puede reintentar.
 */
export async function claimWeeklyTask(task: WeeklyTask, week: string, me: { id: string; host: string }, ttlMs: number): Promise<boolean> {
  const state = await getWeeklyAIState();
  const claim = state.claims?.[task];
  if (claim && claim.week === week && claim.by !== me.id && Date.now() - Date.parse(claim.at) < ttlMs) return false;
  const next: WeeklyClaim = { week, by: me.id, host: me.host, at: new Date().toISOString() };
  await saveWeeklyAIState({ claims: { ...state.claims, [task]: next } });
  return true;
}
