export function computeEngagementPercent(tickets: { isDone: boolean }[]): number {
  if (!tickets.length) return 0;
  return Math.round((tickets.filter((t) => t.isDone).length / tickets.length) * 100);
}
