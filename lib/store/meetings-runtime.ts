import type { Meeting } from "@/types/meeting";
import { mockMeetings } from "@/lib/mock/meetings";
import { mockAccounts } from "@/lib/mock/accounts";

// Store mutable en memoria (sin Supabase todavía). Se resetea al reiniciar el server:
// limitación explícita y temporal de la Fase 1.5 — ver plan "Fase 1.5 — Conexión real a Google".
let runtimeMeetings: Meeting[] = [...mockMeetings];
const ingestedFileIds = new Set<string>();

export function getRuntimeMeetings(): Meeting[] {
  return runtimeMeetings;
}

export function isDocIngested(fileId: string): boolean {
  return ingestedFileIds.has(fileId);
}

export function addMeetingFromDoc(params: {
  fileId: string;
  docName: string;
  docText: string;
  createdTime: string;
}): Meeting | null {
  const account = mockAccounts.find(
    (a) =>
      a.contactEmail &&
      params.docText.toLowerCase().includes(a.contactEmail.split("@")[1].toLowerCase()),
  );
  if (!account) return null;

  const meeting: Meeting = {
    id: `m-drive-${Date.now()}`,
    accountId: account.id,
    title: params.docName,
    meetingDate: params.createdTime,
    source: "gemini_notes",
    rawNotes: params.docText,
  };

  runtimeMeetings = [...runtimeMeetings, meeting];
  ingestedFileIds.add(params.fileId);
  return meeting;
}
