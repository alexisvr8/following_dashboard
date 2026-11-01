export type TicketSource = "manual" | "gmail" | "calendar" | "notion" | "xtract" | "gemini_notes";

export interface Ticket {
  id: string;
  accountId: string;
  meetingId: string | null;
  title: string;
  description?: string;
  weekStartDate: string;
  isDone: boolean;
  /** Cuándo se marcó hecho (null = hecho antes de registrar fechas). */
  doneAt?: string | null;
  /** Viene de una reunión anterior y sigue abierto (o se cerró después). */
  carried?: boolean;
  /** Fecha de la reunión que lo generó. */
  meetingDate?: string;
  source: TicketSource;
}
