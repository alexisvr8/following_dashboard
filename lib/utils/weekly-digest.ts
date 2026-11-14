import type { ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { plannedItems, type PlannedItem } from "@/lib/utils/deadlines";
import { analysisView } from "@/lib/utils/account-analysis";

// Resumen del lunes a mí mismo (borrador en Gmail, nunca al cliente): por cuenta asignada, estado y resumen del
// análisis IA, lo que debo y me deben esta semana (del tablero actual), posibles resueltos, riesgos y qué decir en
// el próximo mail. Orden: 🔥 más atención → en riesgo / bloqueadas / esperando a Xtract → resto. Texto plano con el
// formato que `bodyToHtml` convierte (títulos con ":" en negrita, viñetas • en listas).

const STATE_RANK: Record<string, number> = {
  en_riesgo: 0,
  bloqueada: 1,
  esperando_xtract: 2,
  esperando_cliente: 3,
  avanzando: 4,
  sin_actividad: 5,
};
const fmtDay = (d: Date) => d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
const MAX_ITEMS = 5;

export function buildWeeklyDigest(
  clients: ClientRecord[],
  settings: WorkSettings,
  now: Date,
  appUrl: string | null,
): { subject: string; body: string; accounts: number } {
  const assigned = clients.filter((c) => c.status === "assigned");
  const items = plannedItems(assigned, settings, now);
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - now.getDay() + 7) % 7), 23, 59, 59).toISOString();
  const byClient = new Map<string, PlannedItem[]>();
  for (const it of items) byClient.set(it.clientId, [...(byClient.get(it.clientId) ?? []), it]);

  const rows = assigned
    .map((c) => ({ c, view: analysisView(c), items: byClient.get(c.id) ?? [] }))
    .sort(
      (a, b) =>
        Number(Boolean(b.c.profile?.attention)) - Number(Boolean(a.c.profile?.attention)) ||
        (STATE_RANK[a.view?.state ?? ""] ?? 9) - (STATE_RANK[b.view?.state ?? ""] ?? 9) ||
        a.c.name.localeCompare(b.c.name, "es"),
    );

  const overdue = items.filter((i) => i.bucket === "overdue" && i.side === "debo").length;
  const mine = items.filter((i) => i.side === "debo" && i.due <= endOfWeek).length;
  const theirs = items.filter((i) => i.side === "me_deben").length;
  const risky = rows.filter((r) => r.view && (r.view.state === "en_riesgo" || r.view.state === "bloqueada")).map((r) => r.c.name);

  const line = (i: PlannedItem) => `• ${i.title}${i.owners.length && i.side === "me_deben" ? ` (${i.owners[0].split(/\s+/)[0]})` : ""} · ${i.dueLabel}`;
  const lines: string[] = [
    "Buen día,",
    "",
    `Esta semana: ${mine} accionables tuyos para cerrar${overdue ? ` (${overdue} vencidos)` : ""}, ${theirs} que te deben, ${rows.length} cuentas.`,
    ...(risky.length ? [`En riesgo o bloqueadas: ${risky.join(", ")}.`] : []),
  ];

  const link = (c: ClientRecord) => (appUrl ? `${appUrl.replace(/\/$/, "")}/cuentas/${encodeURIComponent(c.id)}` : null);
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t);
  // Foco = 🔥, en riesgo / bloqueada / esperando a Xtract, o con algo mío vencido: detalle completo. Resto: compacto.
  const isFocus = (r: (typeof rows)[number]) =>
    Boolean(r.c.profile?.attention) ||
    ["en_riesgo", "bloqueada", "esperando_xtract"].includes(r.view?.state ?? "") ||
    r.items.some((i) => i.side === "debo" && i.bucket === "overdue");
  const focus = rows.filter(isFocus);
  const rest = rows.filter((r) => !isFocus(r));

  if (focus.length) lines.push("", "", `FOCO DE LA SEMANA (${focus.length}):`);
  for (const { c, view, items: its } of focus) {
    const debo = its.filter((i) => i.side === "debo").slice(0, MAX_ITEMS);
    const meDeben = its.filter((i) => i.side === "me_deben").slice(0, 3);
    const resolved = view?.resolved.filter((r) => !r.done) ?? [];
    const url = link(c);
    lines.push(
      "",
      "",
      `${c.profile?.attention ? "🔥 " : ""}${c.name}${view ? ` · ${view.stateLabel}` : ""}:`,
      ...(view ? [clip(view.resumen, 420)] : ["Sin análisis IA esta semana."]),
      ...(debo.length ? ["", "Debo:", ...debo.map(line)] : []),
      ...(meDeben.length ? ["", "Me deben:", ...meDeben.map(line)] : []),
      ...(resolved.length ? ["", "Posibles resueltos (tildalos si es así):", ...resolved.map((r) => `• ${r.title}`)] : []),
      ...(view?.risks.length ? ["", "Riesgo principal:", `• ${clip(view.risks[0], 260)}`] : []),
      ...(view ? ["", `Próximo mail: ${clip(view.nextMail, 420)}`] : []),
      ...(url ? [url] : []),
    );
  }

  if (rest.length) {
    lines.push("", "", `RESTO DE LAS CUENTAS (${rest.length}):`);
    for (const { c, view, items: its } of rest) {
      const debo = its.filter((i) => i.side === "debo");
      const meDeben = its.filter((i) => i.side === "me_deben").length;
      const next = debo[0];
      lines.push(
        "",
        `${c.name}${view ? ` · ${view.stateLabel}` : ""}:`,
        `• ${debo.length} míos${next ? ` (próximo: ${next.title}, ${next.dueLabel})` : ""} · ${meDeben} me deben`,
        ...(view ? [`• Próximo mail: ${clip(view.nextMail, 220)}`] : []),
      );
    }
  }
  lines.push("", "", "Generado automáticamente por Metodología Xtract (solo para vos, no se envió a nadie).");
  return { subject: `Plan de la semana · ${fmtDay(now)}`, body: lines.join("\n"), accounts: rows.length };
}
