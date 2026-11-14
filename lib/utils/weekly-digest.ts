import type { ClientRecord } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { plannedItems, type PlannedItem } from "@/lib/utils/deadlines";
import { analysisView, type AnalysisView } from "@/lib/utils/account-analysis";

// Resumen del lunes a mí mismo (nunca al cliente): por cuenta asignada, estado y resumen del análisis IA, lo que
// debo y me deben (del tablero actual), posibles resueltos, riesgo principal y qué decir en el próximo mail.
// Orden: 🔥 más atención → en riesgo / bloqueadas / esperando a Xtract / con algo mío vencido (FOCO, con detalle)
// → resto (compacto). Devuelve texto plano (parte text/plain) y HTML con una tarjeta por cliente (solo estilos
// inline, para Gmail/Outlook).

const STATE_RANK: Record<string, number> = {
  en_riesgo: 0,
  bloqueada: 1,
  esperando_xtract: 2,
  esperando_cliente: 3,
  avanzando: 4,
  sin_actividad: 5,
};
const STATE_COLOR: Record<string, { fg: string; bg: string }> = {
  en_riesgo: { fg: "#b42318", bg: "#fef3f2" },
  bloqueada: { fg: "#b42318", bg: "#fef3f2" },
  esperando_xtract: { fg: "#b54708", bg: "#fffaeb" },
  esperando_cliente: { fg: "#475467", bg: "#f2f4f7" },
  avanzando: { fg: "#067647", bg: "#ecfdf3" },
  sin_actividad: { fg: "#475467", bg: "#f2f4f7" },
};
const fmtDay = (d: Date) => d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
const MAX_ITEMS = 5;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t);

interface Row {
  c: ClientRecord;
  view: AnalysisView | null;
  items: PlannedItem[];
  url: string | null;
}

export function buildWeeklyDigest(
  clients: ClientRecord[],
  settings: WorkSettings,
  now: Date,
  appUrl: string | null,
): { subject: string; body: string; html: string; accounts: number } {
  const assigned = clients.filter((c) => c.status === "assigned");
  const items = plannedItems(assigned, settings, now);
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - now.getDay() + 7) % 7), 23, 59, 59).toISOString();
  const byClient = new Map<string, PlannedItem[]>();
  for (const it of items) byClient.set(it.clientId, [...(byClient.get(it.clientId) ?? []), it]);
  const link = (c: ClientRecord) => (appUrl ? `${appUrl.replace(/\/$/, "")}/cuentas/${encodeURIComponent(c.id)}` : null);

  const rows: Row[] = assigned
    .map((c) => ({ c, view: analysisView(c), items: byClient.get(c.id) ?? [], url: link(c) }))
    .sort(
      (a, b) =>
        Number(Boolean(b.c.profile?.attention)) - Number(Boolean(a.c.profile?.attention)) ||
        (STATE_RANK[a.view?.state ?? ""] ?? 9) - (STATE_RANK[b.view?.state ?? ""] ?? 9) ||
        a.c.name.localeCompare(b.c.name, "es"),
    );
  const isFocus = (r: Row) =>
    Boolean(r.c.profile?.attention) ||
    ["en_riesgo", "bloqueada", "esperando_xtract"].includes(r.view?.state ?? "") ||
    r.items.some((i) => i.side === "debo" && i.bucket === "overdue");
  const focus = rows.filter(isFocus);
  const rest = rows.filter((r) => !isFocus(r));

  const overdue = items.filter((i) => i.bucket === "overdue" && i.side === "debo").length;
  const mine = items.filter((i) => i.side === "debo" && i.due <= endOfWeek).length;
  const theirs = items.filter((i) => i.side === "me_deben").length;
  const risky = rows.filter((r) => r.view && (r.view.state === "en_riesgo" || r.view.state === "bloqueada")).map((r) => r.c.name);
  const intro = `Esta semana: ${mine} accionables tuyos para cerrar${overdue ? ` (${overdue} vencidos)` : ""}, ${theirs} que te deben, ${rows.length} cuentas.`;
  const riskLine = risky.length ? `En riesgo o bloqueadas: ${risky.join(", ")}.` : null;

  const itemText = (i: PlannedItem) =>
    `${i.title}${i.owners.length && i.side === "me_deben" ? ` (${i.owners[0].split(/\s+/)[0]})` : ""} · ${i.dueLabel}`;
  const detail = (r: Row) => {
    const debo = r.items.filter((i) => i.side === "debo").slice(0, MAX_ITEMS);
    const meDeben = r.items.filter((i) => i.side === "me_deben").slice(0, 3);
    return {
      debo,
      meDeben,
      resolved: r.view?.resolved.filter((x) => !x.done) ?? [],
      risk: r.view?.risks[0] ? clip(r.view.risks[0], 260) : null,
      nextMail: r.view ? clip(r.view.nextMail, 420) : null,
      summary: r.view ? clip(r.view.resumen, 420) : "Sin análisis IA esta semana.",
    };
  };
  const compact = (r: Row) => {
    const debo = r.items.filter((i) => i.side === "debo");
    const next = debo[0];
    return {
      line: `${debo.length} míos${next ? ` (próximo: ${next.title}, ${next.dueLabel})` : ""} · ${r.items.filter((i) => i.side === "me_deben").length} me deben`,
      nextMail: r.view ? clip(r.view.nextMail, 220) : null,
    };
  };
  const title = (r: Row) => `${r.c.profile?.attention ? "🔥 " : ""}${r.c.name}`;

  // ---- Texto plano
  const lines: string[] = ["Buen día,", "", intro, ...(riskLine ? [riskLine] : [])];
  if (focus.length) lines.push("", "", `FOCO DE LA SEMANA (${focus.length}):`);
  for (const r of focus) {
    const d = detail(r);
    lines.push(
      "",
      "────────────────────────",
      `${title(r)}${r.view ? ` · ${r.view.stateLabel}` : ""}:`,
      d.summary,
      ...(d.debo.length ? ["", "Debo:", ...d.debo.map((i) => `• ${itemText(i)}`)] : []),
      ...(d.meDeben.length ? ["", "Me deben:", ...d.meDeben.map((i) => `• ${itemText(i)}`)] : []),
      ...(d.resolved.length ? ["", "Posibles resueltos (tildalos si es así):", ...d.resolved.map((x) => `• ${x.title}`)] : []),
      ...(d.risk ? ["", "Riesgo principal:", `• ${d.risk}`] : []),
      ...(d.nextMail ? ["", `Próximo mail: ${d.nextMail}`] : []),
      ...(r.url ? [r.url] : []),
    );
  }
  if (rest.length) {
    lines.push("", "", `RESTO DE LAS CUENTAS (${rest.length}):`);
    for (const r of rest) {
      const k = compact(r);
      lines.push("", `${r.c.name}${r.view ? ` · ${r.view.stateLabel}` : ""}:`, `• ${k.line}`, ...(k.nextMail ? [`• Próximo mail: ${k.nextMail}`] : []));
    }
  }
  lines.push("", "", "Generado automáticamente por Metodología Xtract (solo para vos).");

  // ---- HTML: una tarjeta por cliente
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const badge = (state: string | undefined, label: string | undefined) => {
    if (!state || !label) return "";
    const c = STATE_COLOR[state] ?? STATE_COLOR.sin_actividad;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;color:${c.fg};background:${c.bg};">${esc(label)}</span>`;
  };
  const head = (r: Row, size: number) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>` +
    `<td style="${font}font-size:${size}px;font-weight:700;color:#101828;">${esc(title(r))}</td>` +
    `<td align="right" style="${font}white-space:nowrap;">${badge(r.view?.state, r.view?.stateLabel)}</td></tr></table>`;
  const label = (t: string, color = "#344054") =>
    `<p style="${font}margin:12px 0 4px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:${color};">${esc(t)}</p>`;
  const list = (xs: string[]) =>
    `<ul style="${font}margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:#344054;">${xs.map((x) => `<li style="margin:2px 0;">${esc(x)}</li>`).join("")}</ul>`;
  const card = (r: Row, inner: string, accent: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 14px;border:1px solid #e4e7ec;border-left:4px solid ${accent};border-radius:8px;background:#ffffff;">` +
    `<tr><td style="padding:14px 16px;">${inner}</td></tr></table>`;
  const accentOf = (r: Row) => (r.c.profile?.attention ? "#f79009" : STATE_COLOR[r.view?.state ?? ""]?.fg ?? "#98a2b3");
  const section = (t: string) =>
    `<p style="${font}margin:22px 0 10px;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#475467;border-bottom:1px solid #e4e7ec;padding-bottom:6px;">${esc(t)}</p>`;
  const open = (url: string | null) =>
    url ? `<p style="${font}margin:12px 0 0;font-size:13px;"><a href="${esc(url)}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">Abrir cuenta →</a></p>` : "";

  const html = [
    `<div style="${font}max-width:680px;margin:0 auto;padding:4px;background:#f9fafb;">`,
    `<p style="${font}margin:0 0 6px;font-size:14px;color:#101828;">Buen día,</p>`,
    `<p style="${font}margin:0 0 4px;font-size:14px;color:#344054;">${esc(intro)}</p>`,
    riskLine ? `<p style="${font}margin:0;font-size:14px;color:#b42318;font-weight:600;">${esc(riskLine)}</p>` : "",
    focus.length ? section(`Foco de la semana (${focus.length})`) : "",
    ...focus.map((r) => {
      const d = detail(r);
      return card(
        r,
        head(r, 16) +
          `<p style="${font}margin:8px 0 0;font-size:13px;line-height:1.5;color:#475467;">${esc(d.summary)}</p>` +
          (d.debo.length ? label("Debo") + list(d.debo.map(itemText)) : "") +
          (d.meDeben.length ? label("Me deben") + list(d.meDeben.map(itemText)) : "") +
          (d.resolved.length ? label("Posibles resueltos (tildalos si es así)", "#067647") + list(d.resolved.map((x) => x.title)) : "") +
          (d.risk ? label("Riesgo principal", "#b42318") + list([d.risk]) : "") +
          (d.nextMail
            ? `<div style="${font}margin:12px 0 0;padding:10px 12px;border-radius:6px;background:#f2f4f7;font-size:13px;line-height:1.5;color:#344054;"><b>Próximo mail:</b> ${esc(d.nextMail)}</div>`
            : "") +
          open(r.url),
        accentOf(r),
      );
    }),
    rest.length ? section(`Resto de las cuentas (${rest.length})`) : "",
    ...rest.map((r) => {
      const k = compact(r);
      return card(
        r,
        head(r, 14) +
          `<p style="${font}margin:6px 0 0;font-size:13px;color:#344054;">${esc(k.line)}</p>` +
          (k.nextMail ? `<p style="${font}margin:4px 0 0;font-size:12px;line-height:1.5;color:#667085;"><b>Próximo mail:</b> ${esc(k.nextMail)}</p>` : "") +
          (r.url ? `<p style="${font}margin:6px 0 0;font-size:12px;"><a href="${esc(r.url)}" style="color:#1d4ed8;text-decoration:none;">Abrir cuenta →</a></p>` : ""),
        "#d0d5dd",
      );
    }),
    `<p style="${font}margin:18px 0 0;font-size:12px;color:#98a2b3;">Generado automáticamente por Metodología Xtract (solo para vos).</p>`,
    `</div>`,
  ].join("");

  return { subject: `Plan de la semana · ${fmtDay(now)}`, body: lines.join("\n"), html, accounts: rows.length };
}
