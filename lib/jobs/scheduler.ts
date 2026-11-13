import { runSync } from "@/lib/jobs/sync-job";
import { getSettings } from "@/lib/store/settings-store";
import { getSyncStatus } from "@/lib/store/sync-status-store";
import { getClientsFile } from "@/lib/store/clients-store";
import { listEventsBetween } from "@/lib/integrations/calendar";

// Scheduler interno (sin dependencias): un tick por minuto contra la hora local del servidor (`TZ`).
// - Lunes (`CRON_DRAFTS_DAY`, default 1) desde las `CRON_DRAFTS_AT` (default 08:30): sync + borrador semanal de
//   objetivos por cuenta. Una vez por semana; si a esa hora la Mac estaba dormida, se hace al despertar ese día.
// - Siempre (cada sync): la minuta en borrador de cada reunión nueva.
// - Todos los días (hábiles y fines de semana, si el servidor está prendido) entre `CRON_FROM` y `CRON_TO`
//   (default 8–21), cada `CRON_INTERVAL_MINUTES` (15): sync.
// - Modo rápido: durante `CRON_FAST_MINUTES` (40) después de que termina una reunión de Calendar con externos,
//   sync cada `CRON_FAST_INTERVAL_MINUTES` (2), para que la minuta de Gemini y su borrador lleguen enseguida.
// - Al iniciar o tras un hueco (Mac dormido), si la última corrida es más vieja que el intervalo: sync.

const g = globalThis as unknown as { __cronStarted?: boolean };

const EVENTS_TTL_MS = 30 * 60_000;
const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

const num = (v: string | undefined, def: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : def);

export function startScheduler() {
  if (g.__cronStarted) return; // HMR en dev puede re-ejecutar el módulo
  g.__cronStarted = true;

  const interval = Math.max(1, num(process.env.CRON_INTERVAL_MINUTES, 15));
  const from = num(process.env.CRON_FROM, 8);
  const to = num(process.env.CRON_TO, 21);
  const fastInterval = Math.max(1, num(process.env.CRON_FAST_INTERVAL_MINUTES, 2));
  const fastMinutes = Math.max(0, num(process.env.CRON_FAST_MINUTES, 40));
  // Fines de reunión con externos (ms), de Calendar; se refresca cada 30 min.
  let meetingEnds: number[] = [];
  let eventsFetchedAt = 0;
  const [dH, dM] = (process.env.CRON_DRAFTS_AT ?? "08:30").split(":").map(Number);
  const draftsDay = num(process.env.CRON_DRAFTS_DAY, 1);
  let weeklyTriedAt = 0; // si la corrida semanal falla, se reintenta cada `interval` min (no cada minuto)
  let lastTick = Date.now();

  const log = (msg: string) => console.log(`[sync ${new Date().toLocaleString()}] ${msg}`);

  const run = async (drafts: boolean, reason: string) => {
    const r = await runSync({ drafts, trigger: "scheduler" });
    if (r.skipped) return log(`${reason}: omitido (ya hay una corrida en curso)`);
    log(
      r.ok
        ? `${reason}: ${r.newMeetings} reuniones nuevas, ${r.synced} clientes, ${r.alerts} alertas` +
            (r.meetingDrafts ? `, ${r.meetingDrafts} minutas en borrador` : "") +
            (drafts ? `, ${r.draftsCreated} borradores` : "") + ` (${r.durationMs} ms)`
        : `${reason}: error ${r.error}`,
    );
  };

  const refreshMeetingEnds = async () => {
    if (fastMinutes === 0 || Date.now() - eventsFetchedAt < EVENTS_TTL_MS) return;
    eventsFetchedAt = Date.now();
    const now = Date.now();
    const events = await listEventsBetween(new Date(now - 2 * 3_600_000), new Date(now + 14 * 3_600_000));
    if (!events) return;
    const own = domainOf((await getClientsFile()).ownerEmail ?? "");
    meetingEnds = events
      .filter((e) => (own ? e.attendees.some((a) => domainOf(a) !== own) : e.attendees.length >= 2))
      .map((e) => Date.parse(e.end));
  };

  const tick = async () => {
    const now = new Date();
    const gap = Date.now() - lastTick; // > 2 min ⇒ el proceso estuvo suspendido
    lastTick = Date.now();
    const { workDays } = await getSettings();

    const h = now.getHours();
    const m = now.getMinutes();
    const minuteOfDay = h * 60 + m;
    const inWindow = minuteOfDay >= from * 60 && minuteOfDay <= to * 60;

    if (workDays.includes(now.getDay()) && now.getDay() === draftsDay && minuteOfDay >= dH * 60 + dM) {
      const { lastWeeklyDraftsAt } = await getSyncStatus();
      const dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dH, dM).getTime();
      if ((!lastWeeklyDraftsAt || Date.parse(lastWeeklyDraftsAt) < dueAt) && Date.now() - weeklyTriedAt >= interval * 60_000) {
        weeklyTriedAt = Date.now();
        return run(true, "semanal (objetivos)");
      }
    }
    await refreshMeetingEnds().catch((e) => log(`calendar: ${(e as Error).message}`));
    const t = Date.now();
    const afterMeeting = meetingEnds.some((end) => t >= end && t - end <= fastMinutes * 60_000);
    if (afterMeeting && minuteOfDay % fastInterval === 0) return run(false, "post-reunión");
    if (inWindow && minuteOfDay % interval === 0) return run(false, "periódica");
    if (inWindow && gap > 2 * 60_000) return catchUp("recuperación");
  };

  const catchUp = async (reason: string) => {
    const { lastRunAt } = await getSyncStatus();
    if (!lastRunAt || Date.now() - new Date(lastRunAt).getTime() > interval * 60_000) {
      await run(false, reason);
    }
  };

  const DAYS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
  log(`scheduler activo: cada ${interval} min (${from}–${to} h, todos los días), post-reunión cada ${fastInterval} min por ${fastMinutes} min, objetivos semanales ${DAYS[draftsDay] ?? draftsDay} ${process.env.CRON_DRAFTS_AT ?? "08:30"}`);
  setInterval(() => void tick().catch((e) => log(`error ${(e as Error).message}`)), 60_000);
  // Recuperación al iniciar (en segundo plano, para no bloquear el arranque del servidor).
  setTimeout(() => void catchUp("inicio").catch((e) => log(`error ${(e as Error).message}`)), 10_000);
}
