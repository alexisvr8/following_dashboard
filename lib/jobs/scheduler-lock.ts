import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { getState, setState } from "@/lib/store/backend";

// Candado compartido del scheduler (`app_state.scheduler_lock`): con la app levantada en dos equipos sobre la misma
// base, solo uno corre la sync automática y la rutina del lunes; el otro queda como interfaz (lo manual sigue
// funcionando en ambos). El dueño renueva el candado en cada tick; si deja de hacerlo `LEASE_MS` (equipo apagado o
// dormido), el otro lo toma. Sin compare-and-set en `app_state`: se escribe y se relee tras `CONFIRM_MS`; si dos lo
// toman a la vez, gana el último en escribir y el otro lo ve al releer.
export interface SchedulerLock {
  owner: string;
  host: string;
  startedAt: string;
  heartbeatAt: string;
}

export const LEASE_MS = 3 * 60_000;
const CONFIRM_MS = 3_000;

const g = globalThis as unknown as { __schedulerId?: string };
/** Nombre visible del equipo (`SCHEDULER_NAME` o el hostname). */
export const schedulerHost = () => process.env.SCHEDULER_NAME || hostname();
/** Id de este proceso (sobrevive al HMR de dev). */
export const schedulerId = () => (g.__schedulerId ??= `${schedulerHost()}:${process.pid}:${randomUUID().slice(0, 8)}`);

export const getSchedulerLock = () => getState<SchedulerLock>("scheduler_lock");

export const lockIsFresh = (lock: SchedulerLock | null, now = Date.now()) =>
  Boolean(lock && now - Date.parse(lock.heartbeatAt) < LEASE_MS);

/** Toma o renueva el candado. `true` = este proceso es el que corre el scheduler. */
export async function holdSchedulerLock(): Promise<boolean> {
  const me = schedulerId();
  const current = await getSchedulerLock();
  const now = new Date().toISOString();
  if (current?.owner === me) {
    await setState("scheduler_lock", { ...current, heartbeatAt: now });
    return true;
  }
  if (lockIsFresh(current)) return false;
  await setState("scheduler_lock", { owner: me, host: schedulerHost(), startedAt: now, heartbeatAt: now } satisfies SchedulerLock);
  await new Promise((r) => setTimeout(r, CONFIRM_MS));
  return (await getSchedulerLock())?.owner === me;
}
