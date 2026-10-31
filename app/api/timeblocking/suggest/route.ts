// TODO Fase 2: buscar huecos reales en Google Calendar.
export async function POST(req: Request) {
  const { accountId, durationMinutes = 30 } = await req.json();

  const now = Date.now();
  const suggestedSlots = [1, 2, 3].map((n) => {
    const start = new Date(now + n * 2 * 3_600_000);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return { start: start.toISOString(), end: end.toISOString() };
  });

  return Response.json({ accountId, durationMinutes, suggestedSlots });
}
