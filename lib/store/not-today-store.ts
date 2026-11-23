import { getState, setState } from "@/lib/store/backend";

/**
 * Ajustes a mano de la columna "Hoy" por agenda (`app_state.not_today`):
 * - `ids`: cards que sacaste de Hoy (arrastrándolas a "Esta semana" o con "+1 día"): ese día no entran y el hueco lo
 *   ocupa la siguiente. Valen solo para `day`.
 * - `forced`: id → día (AAAA-MM-DD) en que la card entra sí o sí en Hoy ("+1 día" con reunión próxima con la cuenta:
 *   así se termina antes de la reunión y no amanece atrasada). Se podan al pasar el día.
 */
type NotToday = { day: string; ids: string[]; forced?: Record<string, string> };
export type TodayAdjust = { skip: Set<string>; force: Set<string> };

export const dayKey = (d: Date) => d.toLocaleDateString("sv");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function getTodayAdjust(now = new Date()): Promise<TodayAdjust> {
  const v = await getState<NotToday>("not_today");
  const today = dayKey(now);
  return {
    skip: new Set(v?.day === today ? v.ids : []),
    force: new Set(Object.entries(v?.forced ?? {}).filter(([, d]) => d === today).map(([id]) => id)),
  };
}

/** Saca (o devuelve) una card de Hoy; con `forceOn` además la fija en Hoy ese día. */
export async function setNotToday(id: string, skip: boolean, forceOn?: string | null, now = new Date()): Promise<void> {
  const v = await getState<NotToday>("not_today");
  const today = dayKey(now);
  const ids = new Set(v?.day === today ? v.ids : []);
  if (skip) ids.add(id);
  else ids.delete(id);
  const forced = Object.fromEntries(Object.entries(v?.forced ?? {}).filter(([k, d]) => d >= today && k !== id));
  if (forceOn && DAY.test(forceOn) && forceOn > today) forced[id] = forceOn;
  await setState("not_today", { day: today, ids: [...ids], forced });
}
