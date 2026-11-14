import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";

/**
 * Reuniones de Gemini que llegaron después de cerrar la cuenta (el escaneo las sigue asociando): aviso para
 * reabrirla si Soporte la devuelve. Vacío si la cuenta no está cerrada.
 */
export function meetingsAfterClosure(c: ClientRecord): DiscoveredMeeting[] {
  const at = c.status === "closed" ? c.profile?.closure?.at : undefined;
  if (!at) return [];
  const since = Date.parse(at);
  return c.meetings.filter((m) => Date.parse(m.date) > since);
}
