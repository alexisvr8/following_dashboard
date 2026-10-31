export type MeetingSentiment = "positive" | "neutral" | "negative";

export interface Meeting {
  id: string;
  accountId: string;
  title: string;
  meetingDate: string;
  source: "manual" | "gemini_notes";
  rawNotes?: string;
  sentiment?: MeetingSentiment;
  followupDraft?: string;
  followupReminderAt?: string;
}

export interface GenerateFollowupResponse {
  meetingId: string;
  draftEmail: string;
  sentiment: MeetingSentiment;
  reminderAt: string;
}
