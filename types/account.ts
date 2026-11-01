export type PriorityQuadrant =
  | "quick_win"
  | "major_project"
  | "fill_in"
  | "thankless_task";

export type TrackingStatus =
  | "tasks_generated"
  | "tasks_in_progress"
  | "tasks_priority"
  | "tasks_done";

export interface Account {
  id: string;
  name: string;
  contactEmail: string | null;
  isAssigned: boolean;
  timeScore: number;
  difficultyScore: number;
  calendarMinutesPlanned: number;
  executionMinutesActual: number;
  engagementPercent: number | null;
  lastActivityAt: string | null;
  trackingStatus: TrackingStatus;
  lastNoteSummary: string | null;
  erp?: string | null;
  referentCount?: number;
}
