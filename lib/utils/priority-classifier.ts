import type { PriorityInput } from "@/types/priority";
import type { PriorityQuadrant } from "@/types/account";

export function classifyAccountPriority({
  timeScore,
  difficultyScore,
}: PriorityInput): PriorityQuadrant {
  const lowTime = timeScore <= 2;
  const lowDifficulty = difficultyScore <= 2;
  if (lowTime && lowDifficulty) return "quick_win";
  if (!lowTime && !lowDifficulty) return "major_project";
  if (lowTime && !lowDifficulty) return "thankless_task";
  return "fill_in";
}
