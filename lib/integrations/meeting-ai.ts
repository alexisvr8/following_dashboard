import { getDocText } from "@/lib/integrations/drive";
import { aiEnabled, generatePostMeeting, postMeetingModel, type PostMeetingInput } from "@/lib/llm/postmeeting";
import {
  markMeetingAIFailed,
  meetingHasTicketState,
  setMeetingAI,
  type ClientRecord,
  type ClientsFile,
  type DiscoveredMeeting,
} from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { accountActionables } from "@/lib/utils/actionables";
import { applyCorrections, splitNotesAndTranscript } from "@/lib/utils/transcript";

// Mail post-reunión con IA: en cada sync, para las reuniones recientes de cuentas asignadas que todavía no
// se procesaron, lee el Doc de Gemini (minuta + transcripción), llama a Claude y guarda el JSON en la reunión
// (`setMeetingAI`). Una sola llamada por reunión; si falla se reintenta hasta AI_MAX_ATTEMPTS.

const AI_DAYS = 7;
// Solo reuniones desde que se activó la IA (las anteriores quedan como estaban, sin gastar créditos).
// `AI_SINCE` en el env (ISO) lo cambia; p. ej. para reprocesar más atrás en la reestructuración.
const AI_SINCE_DEFAULT = "2026-11-13T13:45:00-03:00";
const aiSince = () => Date.parse(process.env.AI_SINCE || AI_SINCE_DEFAULT) || Date.parse(AI_SINCE_DEFAULT);
const AI_PER_RUN = 3;
export const AI_MAX_ATTEMPTS = 3;
const OWN_COMPANY = "Xtract";

const companyName = (client: ClientRecord) => client.profile?.emailName || client.name;

function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function buildPostMeetingInput(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  doc: string,
  ownerEmail: string | null,
  settings: WorkSettings,
): PostMeetingInput {
  const ownDomain = ownerEmail?.split("@")[1]?.toLowerCase() ?? "";
  const { notes, transcript } = splitNotesAndTranscript(applyCorrections(doc, settings.corrections));
  const date = new Date(meeting.date).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return {
    clientName: companyName(client),
    ownCompany: OWN_COMPANY,
    meetingDate: date,
    meetingTitle: meeting.title,
    ownerName: settings.ownerAliases[0] ?? "Alexis Vásquez R",
    participants: (meeting.attendees ?? []).map((a) => ({
      name: a.name || nameFromEmail(a.email),
      email: a.email,
      company: ownDomain && a.email.toLowerCase().endsWith(`@${ownDomain}`) ? OWN_COMPANY : companyName(client),
    })),
    openActionables: accountActionables(client)
      .filter((a) => !a.done && a.meeting.id !== meeting.id)
      .map((a) => a.step),
    corrections: settings.corrections.map((c) => ({ from: c.from, to: c.to })),
    erp: client.profile?.erp ?? null,
    notes,
    transcript,
  };
}

/** Reuniones a procesar: última semana, cuentas asignadas, con Doc, sin IA y sin accionables tocados. */
function pendingMeetings(file: ClientsFile): { client: ClientRecord; meeting: DiscoveredMeeting }[] {
  const since = Math.max(Date.now() - AI_DAYS * 86_400_000, aiSince());
  return file.clients
    .filter((c) => c.status === "assigned")
    .flatMap((client) =>
      client.meetings
        .filter(
          (m) =>
            m.docId &&
            !m.ai &&
            (m.aiAttempts ?? 0) < AI_MAX_ATTEMPTS &&
            Date.parse(m.date) >= since &&
            !meetingHasTicketState(client, m.id),
        )
        .map((meeting) => ({ client, meeting })),
    )
    .sort((a, b) => b.meeting.date.localeCompare(a.meeting.date))
    .slice(0, AI_PER_RUN);
}

/** Genera y guarda el mail post-reunión de las reuniones pendientes. Devuelve cuántas se procesaron. */
export async function generateMeetingAI(file: ClientsFile, settings: WorkSettings): Promise<{ generated: number; failed: number }> {
  if (!aiEnabled()) return { generated: 0, failed: 0 };
  let generated = 0;
  let failed = 0;
  // De a una: son pocas por corrida y así no se pisan los límites de la API.
  for (const { client, meeting } of pendingMeetings(file)) {
    try {
      const doc = await getDocText(meeting.docId!);
      const out = await generatePostMeeting(buildPostMeetingInput(client, meeting, doc, file.ownerEmail ?? null, settings));
      if (await setMeetingAI(client.id, meeting.id, out, postMeetingModel())) generated++;
    } catch (error) {
      failed++;
      await markMeetingAIFailed(client.id, meeting.id, (error as Error).message || "error");
    }
  }
  return { generated, failed };
}
