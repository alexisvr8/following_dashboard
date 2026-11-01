import { followupTicketId, type ClientRecord } from "@/lib/store/clients-store";
import type { Account } from "@/types/account";
import type { Meeting } from "@/types/meeting";
import type { Ticket } from "@/types/ticket";
import { computeEngagementPercent } from "@/lib/utils/engagement";
import { computeParticipants } from "@/lib/utils/participants";
import { mailTickets, relatedMailNote } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";

const MEETING_TIME_WINDOW_DAYS = 30;

function mondayOf(isoDate: string): string {
  const d = new Date(isoDate);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

// Proyecta clientes de `.data/clients.json` a los tipos de Dashboard/Tablero.
// - ids de meeting/ticket con prefijo del cliente: una misma reunión puede tener 2 clientes.
// - Tickets = próximos pasos de la ÚLTIMA reunión (lo que se ve y tilda en el Tablero);
//   engagement = % de esos tickets marcados como hechos.
// - calendarMinutesPlanned = minutos en reuniones de los últimos 30 días (Calendar).
//   executionMinutesActual queda en 0: no hay fuente de tiempo de ejecución real todavía.
export function clientsToBoard(
  clients: ClientRecord[],
  now: Date = new Date(),
  ownerEmail: string | null = null,
): { accounts: Account[]; meetings: Meeting[]; tickets: Ticket[] } {
  const accounts: Account[] = [];
  const meetings: Meeting[] = [];
  const tickets: Ticket[] = [];
  const windowStart = now.getTime() - MEETING_TIME_WINDOW_DAYS * 86_400_000;

  for (const client of clients) {
    const sorted = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    const done = new Set(client.doneTicketIds ?? []);

    // Última minuta + arrastrados de minutas anteriores aún abiertos (ver actionables.ts).
    const clientTickets: Ticket[] = accountActionables(client).map((a) => ({
      id: a.id,
      accountId: client.id,
      meetingId: `${client.id}:${a.meeting.id}`,
      title: a.step,
      weekStartDate: mondayOf(a.meeting.date),
      meetingDate: a.meeting.date,
      carried: a.carried,
      isDone: a.done,
      doneAt: a.doneAt,
      source: "gemini_notes" as const,
      description: relatedMailNote(client, a.id),
    }));
    // Accionable propio: enviar el follow-up de la reunión (auto-tildado si el sync detecta
    // un mail mío a referentes posterior a la reunión).
    if (latest) {
      const id = followupTicketId(client.id, latest.id);
      clientTickets.push({
        id,
        accountId: client.id,
        meetingId: `${client.id}:${latest.id}`,
        title: "Enviar follow-up de la reunión (resumen + próximos pasos)",
        weekStartDate: mondayOf(latest.date),
        isDone: done.has(id),
        doneAt: client.doneTicketAt?.[id] ?? null,
        meetingDate: latest.date,
        source: "gmail",
        description: client.followups?.[latest.id]?.gmailDraftId ? "Borrador creado en Gmail" : undefined,
      });
    }
    // Pendientes de mi lado del último mail del cliente (posterior a la última reunión).
    for (const t of mailTickets(client)) {
      clientTickets.push({
        id: t.id,
        accountId: client.id,
        meetingId: latest ? `${client.id}:${latest.id}` : null,
        title: t.title,
        description: t.description,
        weekStartDate: mondayOf(t.date),
        isDone: done.has(t.id),
        doneAt: client.doneTicketAt?.[t.id] ?? null,
        meetingDate: t.date,
        source: "gmail",
      });
    }
    tickets.push(...clientTickets);

    for (const m of sorted) {
      meetings.push({
        id: `${client.id}:${m.id}`,
        accountId: client.id,
        title: m.title,
        meetingDate: m.date,
        source: "gemini_notes",
        durationMinutes: m.durationMinutes ?? null,
        attendeeCount: m.attendees?.length ?? 0,
      });
    }

    accounts.push({
      id: client.id,
      name: client.name,
      contactEmail: client.contactEmails[0] ?? null,
      isAssigned: client.status === "assigned",
      timeScore: 0,
      difficultyScore: 0,
      calendarMinutesPlanned: sorted
        .filter((m) => new Date(m.date).getTime() >= windowStart)
        .reduce((sum, m) => sum + (m.durationMinutes ?? 0), 0),
      executionMinutesActual: 0,
      engagementPercent: computeEngagementPercent(clientTickets),
      lastActivityAt: latest?.date ?? null,
      trackingStatus: client.trackingStatus ?? "tasks_generated",
      lastNoteSummary: latest?.summary ?? null,
      erp: client.profile?.erp ?? null,
      referentCount: computeParticipants(client, ownerEmail).filter((p) => p.role === "referent").length,
    });
  }

  return { accounts, meetings, tickets };
}
