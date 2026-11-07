/** Puntos que la app mantiene sola (se tildan al detectar el mail): no se editan ni se quitan. */
export const isAutoTicket = (ticketId: string) => /-(followup|reply)$/.test(ticketId);
