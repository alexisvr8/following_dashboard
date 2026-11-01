export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function daysAgo(iso: string, now = Date.now()): string {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  return `hace ${d} días`;
}
