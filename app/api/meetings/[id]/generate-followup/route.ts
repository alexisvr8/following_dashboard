import type { GenerateFollowupResponse } from "@/types/meeting";

// TODO Fase 2: redactar el borrador real en la cadena de Gmail y correr análisis de sentimiento.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const body: GenerateFollowupResponse = {
    meetingId: id,
    draftEmail: "Borrador mock: gracias por la reunión, estos son los próximos pasos...",
    sentiment: "neutral",
    reminderAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  };

  return Response.json(body);
}
