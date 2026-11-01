import type { GenerateFollowupResponse } from "@/types/meeting";
import { mockAccounts } from "@/lib/mock/accounts";
import { mockTickets } from "@/lib/mock/tickets";
import { getRuntimeMeetings } from "@/lib/store/meetings-runtime";
import { findLatestThreadForEmail, createDraftReply } from "@/lib/integrations/gmail";

// Análisis de sentimiento real sobre el hilo de Gmail queda fuera de esta fase.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const meeting = getRuntimeMeetings().find((m) => m.id === id);
  const account = meeting ? mockAccounts.find((a) => a.id === meeting.accountId) : undefined;
  const openTickets = mockTickets.filter((t) => t.meetingId === id && !t.isDone);

  const draftLines = [
    "Hola,",
    "",
    "Gracias por la reunión. Estos son los próximos pasos:",
    ...(openTickets.length
      ? openTickets.map((t) => `- ${t.title}`)
      : ["- (sin accionables pendientes registrados)"]),
    "",
    "Saludos.",
  ];
  const draftEmail = draftLines.join("\n");

  if (account?.contactEmail) {
    const thread = await findLatestThreadForEmail(account.contactEmail);
    if (thread?.id) {
      await createDraftReply(thread.id, account.contactEmail, draftEmail);
    }
  }

  const body: GenerateFollowupResponse = {
    meetingId: id,
    draftEmail,
    sentiment: meeting?.sentiment ?? "neutral",
    reminderAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  };

  return Response.json(body);
}
