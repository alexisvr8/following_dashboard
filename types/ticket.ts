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
  /** Surge de un mail posterior a la última reunión (pedido del cliente o compromiso mío). */
  origin?: "mail";
  /** Card del Tablero a la que pertenece (ver `assignCards`). */
  cardId?: string;
  /** Reunión o mail de donde salió: una card puede juntar varios. */
  sourceId?: string;
  sourceKind?: "meeting" | "mail";
  sourceTitle?: string;
  sourceDate?: string;
}
