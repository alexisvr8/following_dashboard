import type { Account } from "@/types/account";

/** Más reciente primero; sin movimiento al final; desempate por nombre. */
export function byMovement(a: Account, b: Account): number {
  const at = (x: Account) => (x.lastMovementAt ? Date.parse(x.lastMovementAt) : 0);
  return at(b) - at(a) || a.name.localeCompare(b.name, "es");
}

/** Título de agrupación por antigüedad del último movimiento. */
export function movementBucket(iso: string | null | undefined, now: Date): string {
  if (!iso) return "Anteriores";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  // Lunes de esta semana = hace (getDay + 6) % 7 días.
  return diff <= (today.getDay() + 6) % 7 ? "Esta semana" : "Anteriores";
}
