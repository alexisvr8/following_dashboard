import type { Meeting } from "@/types/meeting";

export function getLatestMeeting(accountId: string, meetings: Meeting[]): Meeting | null {
  const accountMeetings = meetings.filter((m) => m.accountId === accountId);
  if (!accountMeetings.length) return null;
  return accountMeetings.reduce((latest, m) =>
    new Date(m.meetingDate) > new Date(latest.meetingDate) ? m : latest,
  );
}
