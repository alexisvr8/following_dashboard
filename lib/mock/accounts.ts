import type { Account } from "@/types/account";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export const mockAccounts: Account[] = [
  {
    id: "acc-1",
    name: "Nova Retail",
    isAssigned: true,
    timeScore: 2,
    difficultyScore: 1,
    calendarMinutesPlanned: 180,
    executionMinutesActual: 150,
    engagementPercent: null,
    lastActivityAt: daysAgo(2),
  },
  {
    id: "acc-2",
    name: "Finbright Capital",
    isAssigned: true,
    timeScore: 4,
    difficultyScore: 5,
    calendarMinutesPlanned: 240,
    executionMinutesActual: 90,
    engagementPercent: null,
    lastActivityAt: daysAgo(10),
  },
  {
    id: "acc-3",
    name: "Orbit Logistics",
    isAssigned: true,
    timeScore: 1,
    difficultyScore: 4,
    calendarMinutesPlanned: 60,
    executionMinutesActual: 55,
    engagementPercent: null,
    lastActivityAt: daysAgo(20),
  },
  {
    id: "acc-4",
    name: "Hale & Co",
    isAssigned: false,
    timeScore: 3,
    difficultyScore: 2,
    calendarMinutesPlanned: 0,
    executionMinutesActual: 0,
    engagementPercent: null,
    lastActivityAt: null,
  },
  {
    id: "acc-5",
    name: "Brightleaf Studios",
    isAssigned: false,
    timeScore: 2,
    difficultyScore: 3,
    calendarMinutesPlanned: 30,
    executionMinutesActual: 10,
    engagementPercent: null,
    lastActivityAt: daysAgo(5),
  },
];
