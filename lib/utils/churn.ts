export type ChurnRiskLevel = "green" | "yellow" | "red";

export function computeChurnRisk(
  lastActivityAt: string | null,
  now: Date = new Date(),
): ChurnRiskLevel {
  if (!lastActivityAt) return "red";
  const days = (now.getTime() - new Date(lastActivityAt).getTime()) / 86_400_000;
  if (days <= 7) return "green";
  if (days <= 14) return "yellow";
  return "red";
}
