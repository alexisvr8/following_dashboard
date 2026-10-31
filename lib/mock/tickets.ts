import type { Ticket } from "@/types/ticket";

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const thisWeek = mondayOf(new Date());
const lastWeek = mondayOf(new Date(Date.now() - 7 * 86_400_000));

export const mockTickets: Ticket[] = [
  { id: "t-1", accountId: "acc-1", title: "Revisar métricas de campaña", weekStartDate: thisWeek, isDone: true, source: "manual" },
  { id: "t-2", accountId: "acc-1", title: "Enviar reporte mensual", weekStartDate: thisWeek, isDone: false, source: "gmail" },
  { id: "t-3", accountId: "acc-1", title: "Agendar QBR", weekStartDate: lastWeek, isDone: true, source: "calendar" },
  { id: "t-4", accountId: "acc-2", title: "Actualizar plan de cuenta", weekStartDate: thisWeek, isDone: false, source: "notion" },
  { id: "t-5", accountId: "acc-2", title: "Seguimiento de onboarding", weekStartDate: thisWeek, isDone: false, source: "manual" },
  { id: "t-6", accountId: "acc-2", title: "Cerrar ticket de soporte", weekStartDate: lastWeek, isDone: true, source: "xtract" },
  { id: "t-7", accountId: "acc-3", title: "Renovar contrato", weekStartDate: thisWeek, isDone: false, source: "manual" },
  { id: "t-8", accountId: "acc-5", title: "Primera llamada de descubrimiento", weekStartDate: thisWeek, isDone: true, source: "manual" },
];
