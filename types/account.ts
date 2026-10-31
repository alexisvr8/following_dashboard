export type PriorityQuadrant =
  | "quick_win"
  | "major_project"
  | "fill_in"
  | "thankless_task";

export type TrackingStatus =
  | "no_contact"
  | "in_progress"
  | "waiting_client"
  | "at_risk"
  | "closed_ok";

export interface Account {
  id: string;
  name: string;
  isAssigned: boolean;
  timeScore: number;
  difficultyScore: number;
  calendarMinutesPlanned: number;
  executionMinutesActual: number;
  engagementPercent: number | null;
  lastActivityAt: string | null;
  trackingStatus: TrackingStatus;
  lastNoteSummary: string | null;
}
