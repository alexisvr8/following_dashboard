// Vista previa del mail de los lunes (IA + reglas) de unas pocas cuentas, sin crear borradores ni tocar la base.
// Uso: pnpm preview:weekly [-- --n 3] [--id <id o nombre> | --ids a,b,c] [--date AAAA-MM-DD (lunes simulado)] [--skip nombre1,nombre2] [--weeks 2] [--out weekly-preview.html] [--no-ai]
import { writeFileSync } from "node:fs";
import { bodyToHtml } from "@/lib/integrations/gmail";
import { aiEnabled } from "@/lib/llm/postmeeting";
import { generateWeeklyMail, weeklyMailModel } from "@/lib/llm/weekly-mail";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { buildWeeklyPlan, weeklyAIRequest } from "@/lib/utils/followup";
import { weeklyStyleExamples } from "@/lib/utils/weekly-learning";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function main() {
  const n = Number(arg("n") ?? 3);
  const out = arg("out") ?? "weekly-preview.html";
  const useAI = !process.argv.includes("--no-ai") && aiEnabled();
  // Lunes simulado (por defecto hoy): con una fecha futura, lo enviado esta semana ya cuenta como referencia.
  const start = arg("date") ? new Date(`${arg("date")}T09:00:00`) : new Date();
  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const owner = file.ownerEmail ?? null;
  const latest = (c: (typeof file.clients)[number]) => [...c.meetings].sort((a, b) => b.date.localeCompare(a.date))[0];

  const candidates = file.clients
    .filter((c) => c.status === "assigned" && latest(c))
    .filter((c) => !arg("id") || c.id === arg("id") || norm(c.name).includes(norm(arg("id")!)))
    .filter((c) => !arg("ids") || arg("ids")!.split(",").some((k) => c.id === k.trim() || norm(c.name).includes(norm(k.trim()))))
    .filter((c) => !(arg("skip") ?? "").split(",").filter(Boolean).some((k) => norm(c.name).includes(norm(k.trim()))))
    .map((c) => ({ c, req: weeklyAIRequest(c, latest(c), owner, settings, start) }))
    .filter((x) => x.req)
    // Primero las que tienen algo que pedirle al cliente (es lo que muestra la lista numerada).
    .sort((a, b) => b.req!.input.clientItems.length - a.req!.input.clientItems.length)
    .slice(0, n);
  if (!candidates.length) throw new Error("No hay cuentas asignadas con pendientes");

  const weeks = Math.max(1, Number(arg("weeks") ?? 1));
  const cards: string[] = [];
  for (const { c: original } of candidates) {
    let c = original;
    for (let w = 0; w < weeks; w++) {
      // Lunes simulados consecutivos: cada semana ve el mail de la anterior (como en la corrida real).
      const now = new Date(start.getTime() + w * 7 * 86_400_000);
      const meeting = latest(c);
      const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const m0 = mondayOf(now);
      const weekKey = `week:${m0.getFullYear()}-${String(m0.getMonth() + 1).padStart(2, "0")}-${String(m0.getDate()).padStart(2, "0")}`;
      const req = weeklyAIRequest(c, meeting, owner, settings, now, weeklyStyleExamples(file.clients, c.id, weekKey))!;
      const rules = buildWeeklyPlan(c, meeting, owner, settings, now)!;
      let ai: string | null = null;
      let notes: string[] = [];
      if (useAI) {
        try {
          const output = await generateWeeklyMail(req.input, { clientId: c.id, clientName: c.name, trigger: "preview" });
          const d = buildWeeklyPlan(c, meeting, owner, settings, now, { output, key: req.key })!;
          ai = d.body;
          notes = output.revision;
          const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
          const key = `week:${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
          c = { ...c, followups: { ...(c.followups ?? {}), [key]: d } };
        } catch (e) {
          ai = `Error de IA: ${(e as Error).message}`;
        }
      }
      const label = weeks > 1 ? `${c.name} · semana ${w + 1} (tono: ${req.input.tone})` : c.name;
      console.log(`\n===== ${label} · Para: ${rules.to.join(", ")}\nAsunto: ${rules.subject}\n`);
      console.log(ai ?? rules.body);
      if (notes.length) console.log(`\n[revisión] ${notes.join(" | ")}`);
      const col = (title: string, body: string) => `<div class="col"><h3>${title}</h3><div class="mail">${bodyToHtml(body)}</div></div>`;
      cards.push(`<section><h2>${esc(label)}</h2>
        <p class="meta">Para: ${esc(rules.to.join(", "))}${rules.cc?.length ? ` · Cc: ${esc(rules.cc.join(", "))}` : ""}<br>Asunto: ${esc(rules.subject)}<br>
        Trato: ${req.input.plural ? "ustedes" : "tú"} · Ejemplos de estilo: ${req.input.styleExamples?.length ?? 0} · Mails previos: ${req.input.previousMails.length} · ERP: ${esc(req.input.erp ?? "-")} · Ancla: ${esc(req.input.anchorDate ?? "-")} · Pendientes del cliente: ${req.input.clientItems.length}</p>
        <div class="cols">${ai ? col(`IA (${weeklyMailModel()})`, ai) : ""}${col("Reglas (respaldo)", rules.body)}</div>
        ${notes.length ? `<p class="notes">Revisión: ${esc(notes.join(" · "))}</p>` : ""}</section>`);
    }
  }
  writeFileSync(
    out,
    `<!doctype html><meta charset="utf-8"><title>Mail semanal – vista previa</title><style>
      body{font-family:system-ui;background:#f4f4f5;margin:24px;color:#18181b}section{background:#fff;border-radius:8px;padding:16px 20px;margin-bottom:20px}
      .meta{font-size:12px;color:#52525b}.cols{display:flex;gap:16px;flex-wrap:wrap}.col{flex:1;min-width:340px}
      .mail{border:1px solid #e4e4e7;border-radius:6px;padding:12px 16px;font-family:Arial;font-size:14px;line-height:1.5}
      h3{font-size:13px;color:#71717a;margin:8px 0}.notes{font-size:12px;color:#b45309}</style>
      <h1>Mail semanal – vista previa (${candidates.length} cuentas)</h1>${cards.join("")}`,
  );
  console.log(`\nVista previa: ${out}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
