import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { keywordSimilarity } from "@/lib/utils/mail-classify";
import { collectMailItems } from "@/lib/utils/mail-items";

// Accionables vigentes de una cuenta: todos los de la ÚLTIMA minuta + lo abierto de minutas anteriores, sin
// límite de antigüedad: un punto abierto sigue hasta tildarlo o quitarlo. Lo cerrado se ve mientras su reunión
// esté dentro de CARRY_MEETINGS y CARRY_DAYS; después queda en Ejecutadas. Si la minuta nueva repite un punto
// (Gemini suele re-listar lo pendiente) se unen en uno solo y se conserva su estado.

const CARRY_MEETINGS = 3;
// Inicio del arrastre: solo se arrastran minutas que fueron "la última" (visibles y tildables)
// desde esta fecha; las anteriores nunca se pudieron tildar y meterían ruido.
const CARRY_OVER_SINCE = Date.parse("2026-10-31T00:00:00");
const CARRY_DAYS = 28;
const DUPLICATE = 0.6;

export interface Actionable {
  id: string;
  meeting: DiscoveredMeeting;
  step: string;
  carried: boolean;
  done: boolean;
  doneAt: string | null;
  /** La minuta nueva lo repitió y ya estaba cerrado: se mantuvo cerrado. */
  repeatedClosed?: boolean;
}

/** Tarea cerrada de cualquier minuta: el log no se pierde al salir de la ventana de arrastre. */
export interface ExecutedEntry {
  id: string;
  title: string;
  doneAt: string;
  meetingTitle: string;
}

export const stepTicketId = (clientId: string, meetingId: string, i: number) => `${clientId}:${meetingId}-${i}`;

export function accountActionables(client: ClientRecord): Actionable[] {
  const sorted = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  if (!latest) return [];
  const done = new Set(client.doneTicketIds ?? []);
  const at = client.doneTicketAt ?? {};
  const edits = client.actionableEdits ?? {};
  const removed = new Set(client.removedTicketIds ?? []);
  const make = (m: DiscoveredMeeting, step: string, i: number, carried: boolean): Actionable => {
    const id = stepTicketId(client.id, m.id, i);
    return { id, meeting: m, step: edits[id] ?? step, carried, done: done.has(id), doneAt: at[id] ?? null };
  };

  const out = latest.nextSteps.map((s, i) => make(latest, s, i, false)).filter((a) => !removed.has(a.id));
  const cutoff = Date.parse(latest.date) - CARRY_DAYS * 86_400_000;
  for (let k = 1; k < sorted.length; k++) {
    const m = sorted[k];
    const recent = k <= CARRY_MEETINGS && Date.parse(m.date) >= cutoff;
    // Dejó de ser la última cuando llegó la siguiente: si eso fue antes del inicio, no se arrastra.
    if (Date.parse(sorted[k - 1].date) < CARRY_OVER_SINCE) break;
    m.nextSteps.forEach((step, i) => {
      const a = make(m, step, i, true);
      if (removed.has(a.id)) return;
      const twin = out.find((o) => keywordSimilarity(o.step, a.step) >= DUPLICATE);
      if (twin) {
        // Toma el id del cerrado: reabrirlo lo devuelve a pendiente sin perder nada.
        if (a.done && a.doneAt && !twin.done) {
          twin.id = a.id;
          twin.done = true;
          twin.doneAt = a.doneAt;
          twin.repeatedClosed = true;
        }
        return;
      }
      // Cerrados antes de existir fechas no aportan; los viejos quedan en Ejecutadas.
      if (a.done && (!a.doneAt || !recent)) return;
      out.push(a);
    });
  }
  // Los creados a mano no se descartan por parecidos: si lo agregué, lo quiero ver. Cerrados, siguen la ventana de arrastre.
  for (const c of client.customActionables ?? []) {
    const meeting = client.meetings.find((m) => m.id === c.meetingId) ?? latest;
    const isDone = done.has(c.id);
    const doneAt = at[c.id] ?? null;
    if (isDone && (!doneAt || Date.parse(doneAt) < cutoff)) continue;
    out.push({ id: c.id, meeting, step: edits[c.id] ?? c.title, carried: meeting.id !== latest.id, done: isDone, doneAt });
  }
  return out;
}

export function executedHistory(client: ClientRecord): ExecutedEntry[] {
  const done = new Set(client.doneTicketIds ?? []);
  const at = client.doneTicketAt ?? {};
  const edits = client.actionableEdits ?? {};
  const removed = new Set(client.removedTicketIds ?? []);
  const custom = (client.customActionables ?? []).flatMap((c) => {
    const doneAt = at[c.id];
    if (!done.has(c.id) || !doneAt) return [];
    const meetingTitle = client.meetings.find((m) => m.id === c.meetingId)?.title ?? "Agregado a mano";
    return [{ id: c.id, title: edits[c.id] ?? c.title, doneAt, meetingTitle }];
  });
  const items = collectMailItems(client);
  const mail = Object.values(items).flatMap((item) => {
    const doneAt = at[item.id];
    if (!done.has(item.id) || !doneAt || removed.has(item.id)) return [];
    return [{ id: item.id, title: edits[item.id] ?? item.title, doneAt, meetingTitle: `Mail: ${item.subject}` }];
  });
  return client.meetings
    .flatMap((m) =>
      m.nextSteps.flatMap((step, i) => {
        const id = stepTicketId(client.id, m.id, i);
        const doneAt = at[id];
        return done.has(id) && doneAt && !removed.has(id) ? [{ id, title: edits[id] ?? step, doneAt, meetingTitle: m.title }] : [];
      }),
    )
    .concat(custom, mail)
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt));
}
