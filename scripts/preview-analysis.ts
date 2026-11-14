// Vista previa del análisis semanal con IA de UNA cuenta (sin tocar la base salvo --save).
// Uso:
//   pnpm preview:analysis -- --id <id o parte del nombre> [--out analysis-preview.html] [--save]
//     (lee Gmail + Calendar, llama a Claude; guarda <out>.json con la salida y <out>.input.txt con lo que vio el modelo)
//   pnpm preview:analysis -- --id <cliente> --json <out>.json [--save]   (reusa una salida, sin costo)
// --save guarda `client.analysis` y agrega lo nuevo al tablero (igual que la corrida del lunes). Nunca tilda ni envía.
import { readFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/integrations/google-client";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { collectAccountThreads } from "@/lib/integrations/account-mails";
import { sharedExternals } from "@/lib/integrations/client-activity";
import { buildAnalysisMessage, generateAccountAnalysis, type AnalysisUsage } from "@/lib/llm/account-analysis";
import { AccountAnalysisSchema, type AccountAnalysisOutput } from "@/lib/llm/account-analysis-schema";
import { postMeetingModel } from "@/lib/llm/postmeeting";
import { getClientsFile, setAccountAnalysis } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { analysisWindow, buildAnalysisInput, estimatesFromAnalysis, mondayKey, newItemsFromAnalysis, sanitizeRefs } from "@/lib/utils/account-analysis";
import { nextMeetings } from "@/lib/utils/deadlines";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function main() {
  const wanted = arg("id");
  if (!wanted) throw new Error("Pasá --id <id o nombre del cliente>");
  const out = arg("out") ?? "analysis-preview.html";
  const base = out.replace(/\.html?$/, "");
  const now = new Date();

  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const assigned = file.clients.filter((c) => c.status === "assigned");
  const client =
    assigned.find((c) => c.id === wanted) ?? assigned.find((c) => norm(c.name).includes(norm(wanted)) || c.domain === wanted);
  if (!client) throw new Error(`No hay cuenta asignada que coincida con "${wanted}"`);

  const { basis, since } = analysisWindow(client, now);
  const events = await listEventsBetween(now, new Date(now.getTime() + 21 * 86_400_000)).catch(() => null);
  const nextAt = nextMeetings(file.clients, events, now).get(client.id) ?? null;

  let threads: Parameters<typeof buildAnalysisInput>[2] = [];
  let mailsRead = 0;
  let truncated = false;
  let output: AccountAnalysisOutput;
  let usage: AnalysisUsage | null = null;
  let source: string;

  if (arg("json")) {
    const saved = JSON.parse(readFileSync(arg("json")!, "utf8"));
    output = AccountAnalysisSchema.parse(saved.output ?? saved);
    source = `Salida guardada: ${arg("json")}`;
  } else {
    const auth = await getAuthorizedClient();
    if (!auth) throw new Error("Google no está conectado");
    const gmail = google.gmail({ version: "v1", auth });
    const t0 = Date.now();
    const mails = await collectAccountThreads(gmail, client, file.ownerEmail ?? null, sharedExternals(file.clients), since.getTime());
    ({ threads, truncated } = mails);
    mailsRead = mails.messages;
    console.log(`Mails: ${threads.length} hilos, ${mailsRead} mensajes${truncated ? " (truncado)" : ""} en ${Date.now() - t0} ms`);
    const pre = buildAnalysisInput(client, settings, threads, now, nextAt);
    writeFileSync(`${base}.input.txt`, buildAnalysisMessage(pre.input), "utf8");
    const t1 = Date.now();
    const res = await generateAccountAnalysis(pre.input);
    output = res.output;
    usage = res.usage;
    console.log(`Claude (${postMeetingModel()}): ${Date.now() - t1} ms · ${JSON.stringify(usage)}`);
    source = `Generado ahora con ${postMeetingModel()}`;
  }

  const { input, refs, refTexts, rewritable, existing } = buildAnalysisInput(client, settings, threads, now, nextAt);
  output = sanitizeRefs(output, refs, rewritable);
  const newItems = newItemsFromAnalysis(output, settings, since);
  writeFileSync(`${base}.json`, JSON.stringify({ client: client.name, basis, since, refs, output, usage }, null, 2), "utf8");

  const byRef = new Map(input.open.map((o) => [o.ref, o]));
  const lvl = (l: string) => `<span class="lvl ${l}">${l}</span>`;
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">Nada.</p>`);
  const p = output.prioridad;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Análisis IA · ${esc(client.name)}</title>
<style>
:root{--bg:#f4f4f5;--card:#fff;--fg:#18181b;--muted:#71717a;--border:#e4e4e7;--red:#dc2626;--amber:#d97706;--green:#16a34a;--blue:#2563eb;--violet:#7c3aed}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--fg:#fafafa;--muted:#a1a1aa;--border:#3f3f46}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.muted{color:var(--muted);font-size:12px}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;margin-top:16px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.chip{border:1px solid var(--border);border-radius:999px;padding:1px 10px;font-size:12px}
.lvl{border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;color:#fff}.alta{background:var(--red)}.media{background:var(--amber)}.baja{background:var(--green)}
.new{background:var(--violet);color:#fff;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700}.ref{font-family:ui-monospace,monospace;font-size:12px;color:var(--blue)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:720px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--border)}
th{font-size:11px;text-transform:uppercase;color:var(--muted)}ul{margin:0;padding-left:18px}del{color:var(--muted)}
</style></head><body><main>
<h1>${esc(client.name)} · análisis semanal IA</h1>
<p class="muted">${esc(source)} · semana ${mondayKey(now)} · base <b>${basis}</b> · mails desde ${since.toLocaleDateString("es-AR")} ·
${threads.length || "?"} hilos / ${mailsRead || "?"} mensajes${truncated ? " (truncado)" : ""}${usage ? ` · ${usage.input_tokens} in / ${usage.output_tokens} out tokens` : ""} · ${flag("save") ? "GUARDADO" : "sin guardar"}</p>

<div class="card"><div class="row"><span class="chip">${esc(output.estado)}</span> Prioridad ${lvl(p.nivel)}
<span class="muted">engagement ${p.engagement} · complejidad ${p.complejidad}</span></div>
<p>${esc(output.resumen)}</p><p class="muted">Prioridad: ${esc(p.motivo)}</p>
<p class="muted">Última interacción (${esc(output.ultima_interaccion.tipo)} ${esc(output.ultima_interaccion.fecha)}): ${esc(output.ultima_interaccion.resumen)}</p></div>

<div class="card"><h2>Plan de la semana</h2><div class="scroll"><table>
<tr><th>Ref</th><th>Accionable</th><th>Lado</th><th>Responsable</th><th>Prio</th><th>Fecha</th><th>Evidencia</th></tr>
${output.accionables_semana
  .map((a) => {
    const cur = a.ref ? byRef.get(a.ref) : null;
    return `<tr><td>${a.ref ? `<span class="ref">${a.ref}</span>` : `<span class="new">NUEVO</span>`}</td>
<td><b>${esc(a.titulo)}</b><br>${esc(a.descripcion)}${cur ? `<div class="muted">En tablero: ${esc(cur.title)}</div>` : ""}</td>
<td>${a.lado}</td><td>${esc(a.responsable || "—")}</td><td>${lvl(a.prioridad)}</td><td>${esc(a.fecha ?? "—")}</td><td class="muted">${esc(a.evidencia)}</td></tr>`;
  })
  .join("")}
</table></div>
<p class="muted">Con --save entrarían ${newItems.length} nuevos (antes del dedupe contra ${existing.length} pendientes del tablero).</p></div>

<div class="card"><h2>Reescrituras propuestas (D)</h2>${
    output.reescrituras.length
      ? `<div class="scroll"><table><tr><th>Ref</th><th>Hoy</th><th>Propuesta</th><th>Motivo</th></tr>${output.reescrituras
          .map((r) => {
            const cur = byRef.get(r.ref);
            return `<tr><td class="ref">${r.ref}</td><td><del>${esc(cur ? `${cur.title}${cur.detail ? `: ${cur.detail}` : ""}` : "?")}</del></td>
<td>${r.responsable ? `[${esc(r.responsable)}] ` : ""}<b>${esc(r.titulo)}</b>: ${esc(r.descripcion)}</td><td class="muted">${esc(r.motivo)}</td></tr>`;
          })
          .join("")}</table></div>`
      : `<p class="muted">Nada.</p>`
  }</div>

<div class="card"><h2>Posibles resueltos (los tildás vos)</h2>${list(
    output.posibles_resueltos.map((r) => `${r.ref} · ${byRef.get(r.ref)?.title ?? "?"} — ${r.evidencia}`),
  )}</div>

<div class="card"><h2>Conversaciones</h2>${list(
    output.conversaciones.map((c) => `${c.fecha} · ${c.asunto} [${c.estado}, último: ${c.ultimo_de}] — ${c.tema}`),
  )}</div>

<div class="card"><h2>Próximo mail</h2><p>${esc(output.proximo_mail)}</p></div>
<div class="card"><h2>Riesgos</h2>${list(output.riesgos)}</div>
<div class="card"><h2>Para revisar</h2>${list(output.revision)}</div>

<div class="card"><h2>Tablero actual (lo que vio el modelo)</h2>${list(
    input.open.map((o) => `${o.ref} · ${o.side} · ${o.title}${o.detail ? `: ${o.detail}` : ""} · ${o.due}${o.rewritable ? " · reescribible" : ""}`),
  )}</div>
</main></body></html>`;
  writeFileSync(out, html, "utf8");
  console.log(`Vista previa: ${out} · salida: ${base}.json${arg("json") ? "" : ` · entrada: ${base}.input.txt`}`);

  if (flag("save")) {
    const added = await setAccountAnalysis(
      client.id,
      {
        week: mondayKey(now),
        generatedAt: now.toISOString(),
        model: postMeetingModel(),
        basis,
        since: since.toISOString(),
        threadsRead: threads.length,
        mailsRead,
        ...(truncated && { truncated: true }),
        refs,
        refTexts,
        output,
      },
      newItems,
      existing,
      estimatesFromAnalysis(output, refs),
    );
    console.log(`Guardado: ${added?.length ?? 0} accionables nuevos agregados al tablero.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
