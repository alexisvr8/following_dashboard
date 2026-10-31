export type TicketSource = "manual" | "gmail" | "calendar" | "notion" | "xtract";

export interface Ticket {
  id: string;
  accountId: string;
  title: string;
  description?: string;
  weekStartDate: string;
  isDone: boolean;
  source: TicketSource;
}
