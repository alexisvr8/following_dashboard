import { followupTicketId, type ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import type { CalendarEventLite } from "@/lib/integrations/calendar";
import { isOwnActionable, toMinutes } from "@/lib/utils/capacity";
import { mailTickets } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";

// Planificador semanal (meta: cerrar los accionables pendientes antes del viernes).
// Por día: ventana flexible [workStart, workEnd] con un horario normal [coreStart, coreEnd].
// Ocupado = eventos de Calendar + almuerzo (evento "Almuerzo" del día; si no hay, el default
// de settings). Libre = ventana − ocupado, desde ahora. Los accionables PROPIOS pendientes
// de la última reunión de cada cuenta asignada se proyectan primero en huecos del horario
// normal de toda la semana y, si no alcanzan, en los huecos flexibles.

export type BlockKind = "client" | "other" | "lunch" | "task";

export interface PlanBlock {
  kind: BlockKind;
  /** fracción 0–1 dentro de la ventana del día */
  from: number;
  to: number;
  startLabel: string;
  endLabel: string;
  title: string;
  accountName?: string;
  /** almuerzo sin evento en Calendar / accionable en horario flexible */
  soft?: boolean;
}

export interface FreeGap {
  startLabel: string;
  endLabel: string;
  minutes: number;
  flex: boolean;
}

export interface PlanDay {
  key: string;
  label: string;
  isToday: boolean;
  isPast: boolean;
  elapsed: number;
  blocks: PlanBlock[];
  /** reuniones y almuerzo en orden, para la agenda del día */
  agenda: PlanBlock[];
  gaps: FreeGap[];
  meetingCount: number;
  meetingHours: number;
  freeCoreHours: number;
  freeFlexHours: number;
  taskHours: number;
  taskCount: number;
}

export type Verdict = "core" | "flex" | "deficit" | "empty";

export interface WeekPlan {
  offset: number;
  weekLabel: string;
  source: "calendar" | "none";
  window: { coreFrom: number; coreTo: number };
  hourTicks: { label: string; at: number }[];
  days: PlanDay[];
  totals: {
    capacityHours: number;
    meetingBusyHours: number;
    meetingCount: number;
    clientMeetingCount: number;
    clientMeetingHours: number;
    otherHours: number;
    upcomingCount: number;
    freeCoreHours: number;
    freeFlexHours: number;
    pendingCount: number;
    pendingHours: number;
    flexNeededHours: number;
    unscheduledHours: number;
    remainingDays: number;
    /** accionables por día que quedan para cerrar al viernes */
    dailyTarget: number;
    utilization: number;
    finishLabel: string | null;
    verdict: Verdict;
  };
}

const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;
const LUNCH = /\b(almuerzo|lunch|comida)\b/i;
const MIN = 60_000;
const HOUR = 3_600_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (d: Date) => d.toLocaleDateString("es", { weekday: "short", day: "numeric" }).replace(".", "");

type Interval = [number, number];

function union(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(range: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = range[0];
  for (const [a, b] of busy) {
    if (b <= cursor) continue;
    if (a >= range[1]) break;
    if (a > cursor) out.push([cursor, Math.min(a, range[1])]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < range[1]) out.push([cursor, range[1]]);
  return out;
}

const total = (ivs: Interval[]) => ivs.reduce((s, [a, b]) => s + (b - a), 0);

export function planWeekBounds(now: Date, offset: number): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = start.getDay();
  start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow) + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/** true si queda jornada laboral por delante en la semana en curso. */
export function hasWorkLeftThisWeek(now: Date, s: WorkSettings): boolean {
  const { end } = planWeekBounds(now, 0);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (; day < end; day.setDate(day.getDate() + 1)) {
    if (!s.workDays.includes(day.getDay())) continue;
    if (day.getTime() + toMinutes(s.workEnd) * MIN > now.getTime()) return true;
  }
  return false;
}

export function computeWeekPlan(
  clients: ClientRecord[],
  settings: WorkSettings,
  events: CalendarEventLite[] | null,
  offset: number,
  now: Date = new Date(),
): WeekPlan {
  const { start } = planWeekBounds(now, offset);
  const nowMs = now.getTime();
  const wsMin = toMinutes(settings.workStart);
  const weMin = toMinutes(settings.workEnd);
  const csMin = Math.min(Math.max(toMinutes(settings.coreStart), wsMin), weMin);
  const ceMin = Math.max(Math.min(toMinutes(settings.coreEnd), weMin), csMin);
  const span = Math.max(1, weMin - wsMin) * MIN;
  const assigned = clients.filter((c) => c.status === "assigned");

  const matchers = assigned.map((c) => ({
    id: c.id,
    name: c.name,
    emails: new Set(c.contactEmails.map((e) => e.toLowerCase())),
    domain: FREEMAIL.test(c.domain) ? null : c.domain,
  }));
  const accountOf = (e: CalendarEventLite) =>
    matchers.find((m) => e.attendees.some((a) => m.emails.has(a) || (m.domain && a.endsWith(`@${m.domain}`))));

  type Slot = { from: number; to: number; flex: boolean; used: number };
  type DayCtx = PlanDay & { ws: number; slots: Slot[] };
  const days: DayCtx[] = [];
  const nextMeeting = new Map<string, number>();
  let meetingCount = 0;
  let clientMeetingCount = 0;
  let upcomingCount = 0;
  let clientMs = 0;
  let otherMs = 0;
  let busyMeetingMs = 0;
  let capacityMs = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (!settings.workDays.includes(d.getDay())) continue;
    const base = d.getTime();
    const ws = base + wsMin * MIN;
    const we = base + weMin * MIN;
    const cs = base + csMin * MIN;
    const ce = base + ceMin * MIN;
    const frac = (ms: number) => Math.min(1, Math.max(0, (ms - ws) / span));
    const block = (kind: BlockKind, a: number, b: number, title: string, extra?: Partial<PlanBlock>): PlanBlock => ({
      kind, from: frac(a), to: frac(b), startLabel: hhmm(a), endLabel: hhmm(b), title, ...extra,
    });

    const blocks: PlanBlock[] = [];
    const meetings: Interval[] = [];
    const lunches: Interval[] = [];
    let dayMeetings = 0;

    for (const e of events ?? []) {
      const a = Date.parse(e.start);
      const b = Date.parse(e.end);
      if (b <= ws || a >= we) continue;
      const clip: Interval = [Math.max(a, ws), Math.min(b, we)];
      if (LUNCH.test(e.title)) {
        lunches.push(clip);
        blocks.push(block("lunch", clip[0], clip[1], e.title));
        continue;
      }
      const account = accountOf(e);
      meetings.push(clip);
      meetingCount++;
      dayMeetings++;
      if (a > nowMs) upcomingCount++;
      if (account) {
        clientMeetingCount++;
        clientMs += clip[1] - clip[0];
        if (a > nowMs && (!nextMeeting.has(account.id) || a < nextMeeting.get(account.id)!)) {
          nextMeeting.set(account.id, a);
        }
      } else {
        otherMs += clip[1] - clip[0];
      }
      blocks.push(block(account ? "client" : "other", clip[0], clip[1], e.title, { accountName: account?.name }));
    }

    // Sin evento "Almuerzo" ese día → default de settings (marcado como estimado).
    if (!lunches.length && settings.lunchMinutes > 0) {
      const la = base + toMinutes(settings.lunchStart) * MIN;
      const lb = la + settings.lunchMinutes * MIN;
      if (lb > ws && la < we) {
        lunches.push([Math.max(la, ws), Math.min(lb, we)]);
        blocks.push(block("lunch", la, lb, "Almuerzo (estimado)", { soft: true }));
      }
    }

    const lunchU = union(lunches);
    const meetingBusy = union(meetings).flatMap((iv) => subtract(iv, lunchU));
    busyMeetingMs += total(meetingBusy);
    capacityMs += span - total(lunchU);

    const busy = union([...meetings, ...lunches]);
    const free = subtract([Math.max(ws, nowMs), we], busy);
    // partir cada hueco en tramos de horario normal vs flexible
    const slots: Slot[] = [];
    for (const [a, b] of free) {
      const cuts = [a, ...[cs, ce].filter((x) => x > a && x < b), b];
      for (let k = 0; k < cuts.length - 1; k++) {
        const from = cuts[k];
        const to = cuts[k + 1];
        if (to - from < 5 * MIN) continue;
        slots.push({ from, to, flex: from < cs || to > ce, used: 0 });
      }
    }

    days.push({
      key: d.toISOString().slice(0, 10),
      label: dayLabel(d),
      isToday: d.toDateString() === now.toDateString(),
      isPast: we <= nowMs,
      elapsed: frac(nowMs),
      blocks,
      agenda: [...blocks].sort((x, y) => x.from - y.from),
      gaps: free
        .filter(([a, b]) => b - a >= 15 * MIN)
        .map(([a, b]) => ({
          startLabel: hhmm(a),
          endLabel: hhmm(b),
          minutes: Math.round((b - a) / MIN),
          flex: b <= cs || a >= ce,
        })),
      meetingCount: dayMeetings,
      meetingHours: r1(total(meetingBusy) / HOUR),
      freeCoreHours: r1(total(slots.filter((s) => !s.flex).map((s) => [s.from, s.to] as Interval)) / HOUR),
      freeFlexHours: r1(total(slots.filter((s) => s.flex).map((s) => [s.from, s.to] as Interval)) / HOUR),
      taskHours: 0,
      taskCount: 0,
      ws,
      slots,
    });
  }

  // ---- accionables pendientes (cola por urgencia) ----
  const hpaMs = settings.hoursPerActionable * HOUR;
  const queue = assigned
    .map((c) => {
      const latest = [...c.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];
      const done = new Set(c.doneTicketIds ?? []);
      let pending = 0;
      for (const a of accountActionables(c)) if (!a.done && isOwnActionable(a.step, settings)) pending++;
      // Follow-up pendiente solo cuenta si la reunión es reciente (≤14 días).
      if (latest && Date.now() - Date.parse(latest.date) <= 14 * 86_400_000 && !done.has(followupTicketId(c.id, latest.id))) {
        pending++;
      }
      for (const t of mailTickets(c)) if (!done.has(t.id)) pending++;
      return { id: c.id, name: c.name, pending, left: pending * hpaMs, next: nextMeeting.get(c.id) ?? Infinity };
    })
    .filter((a) => a.pending > 0)
    .sort((a, b) => a.next - b.next || b.pending - a.pending);

  const pendingCount = queue.reduce((s, a) => s + a.pending, 0);
  const pendingMs = queue.reduce((s, a) => s + a.left, 0);
  let flexUsedMs = 0;
  let finish: number | null = null;

  // pasada 1: horario normal; pasada 2: horario flexible
  for (const flexPass of [false, true]) {
    for (const day of days) {
      const frac = (ms: number) => Math.min(1, Math.max(0, (ms - day.ws) / span));
      for (const slot of day.slots) {
        if (slot.flex !== flexPass) continue;
        let cursor = slot.from + slot.used;
        while (cursor < slot.to && queue.length) {
          const acc = queue[0];
          const take = Math.min(acc.left, slot.to - cursor);
          if (take < MIN) break;
          day.blocks.push({
            kind: "task",
            from: frac(cursor),
            to: frac(cursor + take),
            startLabel: hhmm(cursor),
            endLabel: hhmm(cursor + take),
            title: `Accionables · ${acc.name}`,
            accountName: acc.name,
            soft: flexPass,
          });
          day.taskHours += take / HOUR;
          if (flexPass) flexUsedMs += take;
          acc.left -= take;
          cursor += take;
          slot.used += take;
          finish = Math.max(finish ?? 0, cursor);
          if (acc.left < MIN) queue.shift();
        }
      }
    }
  }

  for (const day of days) {
    day.taskCount = Math.round((day.taskHours * HOUR) / Math.max(hpaMs, MIN));
    day.taskHours = r1(day.taskHours);
    day.blocks.sort((a, b) => a.from - b.from);
  }

  const unscheduledMs = queue.reduce((s, a) => s + a.left, 0);
  const remainingDays = days.filter((d) => !d.isPast).length;
  const verdict: Verdict = !pendingCount
    ? "empty"
    : unscheduledMs > 0
      ? "deficit"
      : flexUsedMs > 0
        ? "flex"
        : "core";

  const endOfWeek = new Date(start);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  const fmtDay = (d: Date) => d.toLocaleDateString("es", { day: "numeric", month: "short" });
  const hourTicks: { label: string; at: number }[] = [];
  for (let m = Math.ceil(wsMin / 60) * 60; m <= weMin; m += 60) {
    hourTicks.push({ label: `${Math.floor(m / 60)}`, at: (m - wsMin) / (weMin - wsMin) });
  }

  return {
    offset,
    weekLabel: `${fmtDay(start)} – ${fmtDay(endOfWeek)}`,
    source: events ? "calendar" : "none",
    window: { coreFrom: (csMin - wsMin) / (weMin - wsMin), coreTo: (ceMin - wsMin) / (weMin - wsMin) },
    hourTicks,
    days: days.map(({ ws: _ws, slots: _slots, ...d }) => {
      void _ws;
      void _slots;
      return d;
    }),
    totals: {
      capacityHours: r1(capacityMs / HOUR),
      meetingBusyHours: r1(busyMeetingMs / HOUR),
      meetingCount,
      clientMeetingCount,
      clientMeetingHours: r1(clientMs / HOUR),
      otherHours: r1(otherMs / HOUR),
      upcomingCount,
      freeCoreHours: r1(days.reduce((s, d) => s + d.freeCoreHours, 0)),
      freeFlexHours: r1(days.reduce((s, d) => s + d.freeFlexHours, 0)),
      pendingCount,
      pendingHours: r1(pendingMs / HOUR),
      flexNeededHours: r1(flexUsedMs / HOUR),
      unscheduledHours: r1(unscheduledMs / HOUR),
      remainingDays,
      dailyTarget: remainingDays ? Math.ceil(pendingCount / remainingDays) : pendingCount,
      utilization: capacityMs ? Math.round(((busyMeetingMs + pendingMs) / capacityMs) * 100) : 0,
      finishLabel: finish && !unscheduledMs ? dayLabel(new Date(finish)) : null,
      verdict,
    },
  };
}
