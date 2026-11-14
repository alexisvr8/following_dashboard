// Vista previa local del mail post-reunión con IA: mail como llega a Gmail + accionables como se guardan.
// Uso:
//   pnpm preview:postmeeting -- --json <salida.json> --out <preview.html>            (sin costo, reusa una salida)
//   pnpm preview:postmeeting -- --doc "docs/<minuta>.txt" --client "Salvita Alimentos" --out <preview.html>
//     (genera con Claude: ~US$ 0,10; también guarda <preview>.json)
import { readFileSync, writeFileSync } from "node:fs";
import { bodyToHtml } from "@/lib/integrations/gmail";
import { generatePostMeeting, postMeetingModel } from "@/lib/llm/postmeeting";
import { PostMeetingSchema, type PostMeetingOutput } from "@/lib/llm/postmeeting-schema";
import { aiStepText } from "@/lib/store/clients-store";
import { mailFromOutput } from "@/lib/utils/postmeeting-mail";
import { splitNotesAndTranscript } from "@/lib/utils/transcript";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function main() {
  const out = arg("out") ?? "postmeeting-preview.html";
  const client = arg("client") ?? "Salvita Alimentos";
  const me = arg("me") ?? "Alexis";
  const day = arg("day") ?? "11/11";
  let data: PostMeetingOutput;
  let source: string;

  if (arg("json")) {
    data = PostMeetingSchema.parse(JSON.parse(readFileSync(arg("json")!, "utf8")));
    source = `Salida guardada: ${arg("json")}`;
  } else if (arg("doc")) {
    const { notes, transcript } = splitNotesAndTranscript(readFileSync(arg("doc")!, "utf8"));
    data = await generatePostMeeting({
      clientName: client,
      ownCompany: "Xtract",
      meetingDate: arg("date") ?? day,
      meetingTitle: arg("title") ?? arg("doc")!,
      ownerName: arg("owner") ?? "Alexis Vásquez R",
      participants: [],
      openActionables: [],
      corrections: [],
      erp: arg("erp") ?? null,
      notes,
      transcript,
    }, { clientName: client, trigger: "preview" });
    writeFileSync(out.replace(/\.html?$/, "") + ".json", JSON.stringify(data, null, 2), "utf8");
    source = `Generado ahora con ${postMeetingModel()} desde ${arg("doc")}`;
  } else {
    throw new Error("Pasá --json <archivo> o --doc <minuta.txt>");
  }

  const body = mailFromOutput(data, client, me, day);
  const owner = (r: string, empresa: string) => (empresa === "ambas" ? `Xtract y ${client}` : r || "⚠ sin responsable");
  const side = { cliente: client, xtract: "Xtract", ambas: "Ambas" } as const;
  const rows = [
    ...data.accionables.map((a, i) => ({ i, a, status: a.status, fecha: a.fecha, review: a.requiere_revision })),
    ...data.ya_avanzamos.map((a, j) => ({ i: data.accionables.length + j, a, status: "Hecho" as const, fecha: a.fecha ?? day, review: false })),
  ];
  const statusClass = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vista previa post-reunión</title>
<style>
:root{--bg:#f4f4f5;--card:#fff;--fg:#18181b;--muted:#71717a;--border:#e4e4e7;--pend:#d93025;--curso:#e37400;--stand:#5f6368;--hecho:#188038}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--fg:#fafafa;--muted:#a1a1aa;--border:#3f3f46}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px}
.muted{color:var(--muted);font-size:12px}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-top:20px}
.mail{background:#fff;color:#202124;border-radius:8px;padding:24px;border:1px solid #dadce0}
.tabs{display:flex;gap:8px;margin-bottom:12px}.tabs button{border:1px solid var(--border);background:transparent;color:var(--fg);border-radius:6px;padding:4px 10px;cursor:pointer}
.tabs button.on{background:var(--fg);color:var(--bg)}pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;margin:0}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:760px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--border)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td.mono{font-family:ui-monospace,monospace;font-size:12px;white-space:nowrap}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;color:#fff;white-space:nowrap}
.pendiente{background:var(--pend)}.en-curso{background:var(--curso)}.stand-by{background:var(--stand)}.hecho{background:var(--hecho)}
.stored{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:4px}
ul{margin:0;padding-left:18px}
</style></head><body><main>
<h1>Vista previa · mail post-reunión con IA</h1>
<div class="muted">${esc(client)} · ${esc(source)}</div>

<section class="card"><h2>1. Mail</h2>
<div class="tabs"><button class="on" data-t="html">Como llega a Gmail</button><button data-t="txt">Texto del editor</button></div>
<div id="html" class="mail">${bodyToHtml(body)}</div>
<div id="txt" hidden><pre>${esc(body)}</pre></div>
</section>

<section class="card"><h2>2. Accionables que se guardan en la app (${rows.length})</h2>
<div class="muted" style="margin-bottom:8px">Son los mismos del mail. Arriba, el detalle completo de la card; "En el mail" es la versión corta; "Texto guardado" es lo que queda en la reunión y ven /accionables, Capacidad y alertas.</div>
<div class="scroll"><table><thead><tr><th>#</th><th>Título / descripción</th><th>Responsable</th><th>Lado</th><th>Status</th><th>Fecha</th></tr></thead><tbody>
${rows
  .map(
    (r) => `<tr><td class="mono">${r.i}</td><td><strong>${esc(r.a.titulo)}</strong><br>${esc(r.a.descripcion)}<div class="stored">En el mail: ${esc(r.a.resumen_mail)}</div><div class="stored">Texto guardado (card): ${esc(aiStepText(r.a))}</div></td>
<td>${esc(owner(r.a.responsable, r.a.empresa))}${r.review ? " ⚠" : ""}</td><td>${esc(side[r.a.empresa as keyof typeof side])}</td>
<td><span class="badge ${statusClass(r.status)}">${esc(r.status)}</span></td><td class="mono">${esc(r.fecha ?? "—")}</td></tr>`,
  )
  .join("")}
</tbody></table></div></section>

<section class="card"><h2>3. Para revisar antes de enviar</h2>
${data.revision.length ? `<ul>${data.revision.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : '<div class="muted">Sin observaciones del modelo.</div>'}
</section>

<section class="card"><h2>4. JSON devuelto por el modelo</h2><details><summary class="muted">Ver JSON</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details></section>
</main>
<script>
document.querySelectorAll(".tabs button").forEach((b)=>b.addEventListener("click",()=>{
  document.querySelectorAll(".tabs button").forEach((x)=>x.classList.toggle("on",x===b));
  document.getElementById("html").hidden=b.dataset.t!=="html";document.getElementById("txt").hidden=b.dataset.t!=="txt";
}));
</script></body></html>`;
  writeFileSync(out, html, "utf8");
  console.log(`Vista previa: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
