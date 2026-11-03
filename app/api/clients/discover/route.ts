import { backfillMeetingNotes, discoverGeminiMeetings } from "@/lib/integrations/gemini-mail";
import { getClientsFile, knownMeetingIds, mergeDiscovery, setMeetingNotes } from "@/lib/store/clients-store";

// Escaneo manual de mails de Gemini Notes → candidatos de cliente en `.data/clients.json`.
export async function POST(request: Request) {
  const days = Math.min(Number(new URL(request.url).searchParams.get("days")) || 60, 180);
  try {
    const known = knownMeetingIds(await getClientsFile());
    const discovery = await discoverGeminiMeetings(days, known);
    if (!discovery) {
      return Response.json({ error: "google_not_connected" }, { status: 409 });
    }
    const { file, newClients } = await mergeDiscovery(discovery.result);
    await setMeetingNotes(await backfillMeetingNotes(file));
    return Response.json({ ...discovery.stats, newClients, totalClients: file.clients.length });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
