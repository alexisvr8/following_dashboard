import type { Meeting } from "@/types/meeting";

export const mockMeetings: Meeting[] = [
  {
    id: "m-1",
    accountId: "acc-1",
    title: "Check-in quincenal",
    meetingDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    source: "gemini_notes",
    sentiment: "positive",
  },
  {
    id: "m-2",
    accountId: "acc-2",
    title: "Revisión de alcance",
    meetingDate: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    source: "manual",
    sentiment: "neutral",
  },
  {
    id: "m-3",
    accountId: "acc-3",
    title: "Llamada de seguimiento",
    meetingDate: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    source: "manual",
    sentiment: "negative",
  },
  {
    id: "m-5",
    accountId: "acc-5",
    title: "Primera llamada de descubrimiento",
    meetingDate: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    source: "gemini_notes",
    sentiment: "positive",
  },
];
