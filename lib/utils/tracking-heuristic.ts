import type { Meeting } from "@/types/meeting";
import type { Ticket } from "@/types/ticket";
import type { TrackingStatus } from "@/types/account";
import { computeChurnRisk } from "@/lib/utils/churn";

// Placeholder heurístico para Fase 1 — todavía no existe el pipeline LLM/agente que
// interprete el contenido real de las minutas (ver CLAUDE.md, "Pendiente explícito").
// Reemplazar por clasificación basada en el texto de la minuta cuando esa pieza exista.

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export interface TrackingHeuristicInput {
  accountTickets: Ticket[];
  latestMeeting: Meeting | null;
  lastActivityAt: string | null;
  now?: Date;
}

export function classifyTrackingStatus({
  accountTickets,
  latestMeeting,
  lastActivityAt,
  now = new Date(),
}: TrackingHeuristicInput): TrackingStatus {
  if (accountTickets.length === 0) return "tasks_generated";

  const openTickets = accountTickets.filter((t) => !t.isDone);
  if (openTickets.length === 0) return "tasks_done";

  const churnRisk = computeChurnRisk(lastActivityAt, now);
  const negativeSentiment = latestMeeting?.sentiment === "negative";
  const currentWeekMonday = mondayOf(now);
  const hasStaleOpenTicket = openTickets.some((t) => t.weekStartDate < currentWeekMonday);

  if (churnRisk === "red" || negativeSentiment || hasStaleOpenTicket) {
    return "tasks_priority";
  }

  return "tasks_in_progress";
}
