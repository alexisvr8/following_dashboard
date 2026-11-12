import type { Bucket, DueKind, PlannedItem, Priority } from "@/lib/utils/deadlines";

/** Vista elegida (Tablero / Lista): cookie que la página lee en el servidor, sin parpadeo al cargar. */
export const VIEW_COOKIE = "accionables_view";

export const COLUMNS: { key: Bucket; label: string; tone: "critical" | "warning" | "neutral" }[] = [
  { key: "overdue", label: "Vencido", tone: "critical" },
  { key: "today", label: "Hoy", tone: "warning" },
  { key: "this_week", label: "Esta semana", tone: "neutral" },
  { key: "next_week", label: "Próxima semana", tone: "neutral" },
  { key: "later", label: "Más adelante", tone: "neutral" },
];

export const PRIORITY: Record<Priority, { label: string; tone: "critical" | "warning" | "neutral"; stripe: string }> = {
  alta: { label: "Alta", tone: "critical", stripe: "border-l-critical" },
  media: { label: "Media", tone: "warning", stripe: "border-l-warning" },
  baja: { label: "Baja", tone: "neutral", stripe: "border-l-border-strong" },
};

export const DUE_KIND: Record<DueKind, string> = {
  agreed: "Acordada",
  manual: "Manual",
  target: "Meta interna",
};

export const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];

export const fmtMinutes = (m: number) =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`;

const dayFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit" });
const longFmt = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
export const fmtShortDate = (iso: string) => dayFmt.format(new Date(iso));
export const fmtLongDate = (iso: string) => longFmt.format(new Date(iso));

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Atrasado 3 d háb." / "Vence hoy" / "En 2 días háb." */
export function relativeDue(item: PlannedItem): { text: string; tone: "critical" | "warning" | "muted" } {
  const n = item.businessDaysLeft;
  if (item.bucket === "overdue") {
    const late = Math.max(1, -n);
    return { text: `Atrasado ${late} día${late === 1 ? "" : "s"} háb.`, tone: "critical" };
  }
  if (item.bucket === "today" || n <= 0) return { text: "Vence hoy", tone: "warning" };
  return { text: `En ${n} día${n === 1 ? "" : "s"} háb.`, tone: "muted" };
}

export const originLabel = (item: PlannedItem) =>
  `${item.originKind === "mail" ? "Mail" : "Reunión"} ${fmtShortDate(item.originDate)}`;

/** `n` días hábiles después de `from` (para posponer desde el panel). */
export function addWorkdays(from: Date, n: number, workDays: number[]): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (workDays.includes(d.getDay())) left--;
  }
  return d;
}

export const ownMinutes = (items: PlannedItem[]) =>
  items.filter((i) => i.side === "debo").reduce((s, i) => s + i.estimateMinutes, 0);

export async function patchClient(clientId: string, body: unknown): Promise<boolean> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export type Role = "me" | "team" | "client" | "partner";
export const ROLE_LABEL: Record<Role, string> = { me: "Yo", team: "Equipo Xtract", client: "Cliente", partner: "Partner" };
export const personKey = (name: string) =>
  name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Guarda el rol de una persona (null = volver a detectarlo). */
export async function saveRole(people: Record<string, Role>, name: string, role: Role | null): Promise<boolean> {
  const next = { ...people };
  if (role) next[personKey(name)] = role;
  else delete next[personKey(name)];
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ people: next }),
  });
  return res.ok;
}

export async function addCorrection(from: string, to: string): Promise<boolean> {
  const res = await fetch("/api/settings/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  return res.ok;
}

const strip = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * Si entre el texto viejo y el nuevo cambió un solo tramo corto (1–3 palabras, p. ej. "Extract" → "Xtract"),
 * lo devuelve para ofrecer "corregir siempre".
 */
export function correctionCandidate(before: string, after: string): { from: string; to: string } | null {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const from = a.slice(i, a.length - j).map(strip).join(" ").trim();
  const to = b.slice(i, b.length - j).map(strip).join(" ").trim();
  const words = (s: string) => s.split(" ").length;
  if (!from || !to || from.toLowerCase() === to.toLowerCase() || words(from) > 3 || words(to) > 3) return null;
  return { from, to };
}
