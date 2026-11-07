export type PriorityQuadrant =
  | "quick_win"
  | "major_project"
  | "fill_in"
  | "thankless_task";


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
  lastNoteSummary: string | null;
  erp?: string | null;
  referentCount?: number;
  /** Último mail, minuta o evento realizado (ordena las cards). No afecta al churn. */
  lastMovementAt?: string | null;
  lastMovementLabel?: string | null;
}
