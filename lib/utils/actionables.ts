import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { keywordSimilarity } from "@/lib/utils/mail-classify";

// Accionables vigentes de una cuenta: todos los de la ÚLTIMA minuta + los de minutas anteriores
// (hasta CARRY_MEETINGS, dentro de CARRY_DAYS) que siguen abiertos o se cerraron, para que lo no
// finalizado se arrastre a la semana siguiente en vez de desaparecer. Se descartan arrastrados que
// la nueva minuta ya repite (Gemini suele re-listar lo pendiente).

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
}

export const stepTicketId = (clientId: string, meetingId: string, i: number) => `${clientId}:${meetingId}-${i}`;

export function accountActionables(client: ClientRecord): Actionable[] {
  const sorted = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  if (!latest) return [];
  const done = new Set(client.doneTicketIds ?? []);
  const at = client.doneTicketAt ?? {};
  const make = (m: DiscoveredMeeting, step: string, i: number, carried: boolean): Actionable => {
    const id = stepTicketId(client.id, m.id, i);
    return { id, meeting: m, step, carried, done: done.has(id), doneAt: at[id] ?? null };
  };

  const out = latest.nextSteps.map((s, i) => make(latest, s, i, false));
  const cutoff = Date.parse(latest.date) - CARRY_DAYS * 86_400_000;
  for (let k = 1; k <= CARRY_MEETINGS && k < sorted.length; k++) {
    const m = sorted[k];
    if (Date.parse(m.date) < cutoff) break;
    // Dejó de ser la última cuando llegó la siguiente: si eso fue antes del inicio, no se arrastra.
    if (Date.parse(sorted[k - 1].date) < CARRY_OVER_SINCE) break;
    m.nextSteps.forEach((step, i) => {
      const a = make(m, step, i, true);
      // Cerrados antes de existir fechas: no aportan al historial.
      if (a.done && !a.doneAt) return;
      if (out.some((o) => keywordSimilarity(o.step, step) >= DUPLICATE)) return;
      out.push(a);
    });
  }
  return out;
}
