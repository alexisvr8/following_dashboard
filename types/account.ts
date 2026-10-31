export type PriorityQuadrant =
  | "quick_win"
  | "major_project"
  | "fill_in"
  | "thankless_task";

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
}
