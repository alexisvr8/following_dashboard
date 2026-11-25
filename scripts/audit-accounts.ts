// Auditoría ÚNICA de las cuentas asignadas con Opus por Batch API (−50%): cruza las últimas reuniones (minuta +
// transcripción), todos los mails del período (incluidos partners) y el tablero. Nada se aplica solo: las propuestas
// quedan en `client.audit` y se revisan en el modal "Auditoría" de /accionables.
//
//   pnpm audit:accounts -- prepare [--id a,b] [--limit N]   lee Gmail/Drive, arma las entradas y CUENTA tokens (gratis)
//   pnpm audit:accounts -- submit --run <carpeta> [--id a,b] [--max-usd 12]   crea el lote (cobra)
//   pnpm audit:accounts -- collect --run <carpeta> [--wait]  trae resultados, guarda `client.audit`, registra consumo
//   pnpm audit:accounts -- report --run <carpeta>            HTML con todo lo propuesto (sin costo)
//
// Carpeta de corrida: .data/audit/<fecha-hora>/ (entradas, salidas, manifest.json).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/integrations/google-client";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { auditAccountThreads, auditMeetingDocs, collectPartnerThreads, partnerThreadsFor, partnerTargets } from "@/lib/integrations/account-audit";
import { ACCOUNT_AUDIT_SYSTEM_PROMPT } from "@/lib/llm/account-audit-prompt";
import { AccountAuditSchema, type AccountAuditOutput } from "@/lib/llm/account-audit-schema";
import { estimateCost } from "@/lib/llm/pricing";
import { getAIUsage, recordAIUsage } from "@/lib/store/ai-usage-store";
import { getClientsFile, resolveAudit, setAccountAudit, type ClientRecord } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { auditMailSince, auditMeetings, auditView, buildAuditInput, buildAuditMessage, DEV_LABEL } from "@/lib/utils/account-audit";
import { nextMeetings } from "@/lib/utils/deadlines";

const MODEL = process.env.ANTHROPIC_MODEL_AUDIT || "claude-opus-5-5";
const EFFORT = (process.env.AUDIT_EFFORT as "medium" | "high" | "xhigh" | undefined) || "high";
const MAX_TOKENS = 48_000;
/** Salida esperada por cuenta (visible + razonamiento) para estimar antes de mandar. */
const EXPECTED_OUTPUT = 15_000;
const format = zodOutputFormat(AccountAuditSchema);

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const usd = (n: number) => `US$${n.toFixed(2)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Prepared {
  clientId: string;
  clientName: string;
  customId: string;
  refs: Record<string, string>;
  texts: Record<string, string>;
  meetingsRead: number;
  threadsRead: number;
  partnerThreadsRead: number;
  truncated: boolean;
  inputTokens: number;
  message: string;
}

interface Manifest {
  createdAt: string;
  model: string;
  effort: string;
  clients: { clientId: string; clientName: string; customId: string; file: string; inputTokens: number }[];
  batches: { id: string; createdAt: string; customIds: string[] }[];
  collected?: Record<string, { at: string; ok: boolean; saved?: boolean; error?: string; input: number; output: number; costUsd: number }>;
}

const runDir = () => {
  const r = arg("run");
  if (!r) throw new Error("Pasá --run <carpeta de la corrida>");
  const dir = path.isAbsolute(r) ? r : existsSync(r) ? r : path.join(".data", "audit", r);
  if (!existsSync(path.join(dir, "manifest.json"))) throw new Error(`No hay manifest en ${dir}`);
  return dir;
};
const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const saveManifest = (dir: string, m: Manifest) => writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2), "utf8");
const wantedIds = () => arg("id")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

function pickClients(all: ClientRecord[]): ClientRecord[] {
  const ids = wantedIds();
  const assigned = all.filter((c) => c.status === "assigned");
  const picked = ids ? assigned.filter((c) => ids.some((w) => c.id === w || c.name.toLowerCase().includes(w.toLowerCase()))) : assigned;
  const limit = Number(arg("limit") ?? 0);
  return limit > 0 ? picked.slice(0, limit) : picked;
}

async function prepare() {
  const now = new Date();
  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const clients = pickClients(file.clients);
  if (!clients.length) throw new Error("Ninguna cuenta asignada coincide");
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("Google no está conectado");
  const gmail = google.gmail({ version: "v1", auth });
  const anthropic = new Anthropic();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const dir = path.join(".data", "audit", stamp);
  mkdirSync(dir, { recursive: true });

  const events = await listEventsBetween(now, new Date(now.getTime() + 21 * 86_400_000)).catch(() => null);
  const next = nextMeetings(file.clients, events, now);

  // Hilos de partners: una sola lectura, desde la ventana más vieja de las cuentas elegidas.
  const oldest = Math.min(...clients.map((c) => auditMailSince(auditMeetings(c, now), now).getTime()));
  console.log(`Partners/externos compartidos: ${partnerTargets(file).join(", ") || "ninguno"}`);
  const partners = await collectPartnerThreads(gmail, file, oldest);
  console.log(`Hilos con partners en el período: ${partners.length}`);

  const manifest: Manifest = { createdAt: now.toISOString(), model: MODEL, effort: EFFORT, clients: [], batches: [] };
  let totalIn = 0;
  for (const [i, client] of clients.entries()) {
    const t0 = Date.now();
    const meetings = await auditMeetingDocs(client, settings, now);
    const mails = await auditAccountThreads(gmail, client, file, now);
    const exclude = new Set(mails.threads.flatMap((t) => (t.id ? [t.id] : [])));
    const partnerThreads = partnerThreadsFor(client, partners, exclude);
    const { input, refs, texts } = buildAuditInput(client, settings, file.ownerEmail ?? null, now, next.get(client.id) ?? null, meetings, mails.threads, partnerThreads);
    const message = buildAuditMessage(input);
    const count = await anthropic.messages.countTokens({ model: MODEL, system: ACCOUNT_AUDIT_SYSTEM_PROMPT, messages: [{ role: "user", content: message }] });
    const customId = `c${String(i + 1).padStart(2, "0")}`;
    const prepared: Prepared = {
      clientId: client.id,
      clientName: client.name,
      customId,
      refs,
      texts,
      meetingsRead: meetings.length,
      threadsRead: mails.threads.length,
      partnerThreadsRead: partnerThreads.length,
      truncated: mails.truncated || meetings.some((m) => m.cut),
      inputTokens: count.input_tokens,
      message,
    };
    const fileName = `${customId}.json`;
    writeFileSync(path.join(dir, fileName), JSON.stringify(prepared, null, 2), "utf8");
    writeFileSync(path.join(dir, `${customId}.input.txt`), message, "utf8");
    manifest.clients.push({ clientId: client.id, clientName: client.name, customId, file: fileName, inputTokens: count.input_tokens });
    totalIn += count.input_tokens;
    console.log(
      `${customId} ${client.name.padEnd(22)} reuniones ${meetings.length} (transcr. ${meetings.map((m) => Math.round((m.transcript?.length ?? 0) / 1000) + "k").join("/")}) · hilos ${mails.threads.length}${mails.truncated ? "+" : ""} · partner ${partnerThreads.length} · tablero ${Object.keys(refs).length} · ${count.input_tokens.toLocaleString("es-AR")} tokens · ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  }
  saveManifest(dir, manifest);
  const n = manifest.clients.length;
  const estIn = estimateCost({ model: MODEL, input: totalIn, output: 0, cacheRead: 0, cacheWrite: 0, batch: true }) ?? 0;
  const estOut = estimateCost({ model: MODEL, input: 0, output: EXPECTED_OUTPUT * n, cacheRead: 0, cacheWrite: 0, batch: true }) ?? 0;
  const maxOut = estimateCost({ model: MODEL, input: 0, output: MAX_TOKENS * n, cacheRead: 0, cacheWrite: 0, batch: true }) ?? 0;
  console.log(`\nCorrida: ${dir}`);
  console.log(`${n} cuentas · entrada ${totalIn.toLocaleString("es-AR")} tokens (${usd(estIn)} en lote)`);
  console.log(`Estimado total con ~${EXPECTED_OUTPUT / 1000}k de salida por cuenta: ${usd(estIn + estOut)} · techo (salida máxima): ${usd(estIn + maxOut)}`);
}

async function submit() {
  const dir = runDir();
  const manifest = readManifest(dir);
  const ids = wantedIds();
  const already = new Set(manifest.batches.flatMap((b) => b.customIds));
  const targets = manifest.clients.filter((c) => !already.has(c.customId) && (!ids || ids.some((w) => c.clientId === w || c.customId === w || c.clientName.toLowerCase().includes(w.toLowerCase()))));
  if (!targets.length) throw new Error("Nada para mandar (ya enviado o no coincide --id)");
  const totalIn = targets.reduce((n, c) => n + c.inputTokens, 0);
  const ceiling = (estimateCost({ model: manifest.model, input: totalIn, output: MAX_TOKENS * targets.length, cacheRead: 0, cacheWrite: 0, batch: true }) ?? 0);
  const expected = (estimateCost({ model: manifest.model, input: totalIn, output: EXPECTED_OUTPUT * targets.length, cacheRead: 0, cacheWrite: 0, batch: true }) ?? 0);
  const maxUsd = Number(arg("max-usd") ?? 12);
  console.log(`${targets.length} cuentas · estimado ${usd(expected)} · techo ${usd(ceiling)} · tope pedido ${usd(maxUsd)}`);
  if (expected > maxUsd) throw new Error(`El estimado supera --max-usd ${maxUsd}`);
  const anthropic = new Anthropic();
  const batch = await anthropic.messages.batches.create({
    requests: targets.map((c) => {
      const prepared: Prepared = JSON.parse(readFileSync(path.join(dir, c.file), "utf8"));
      return {
        custom_id: c.customId,
        params: {
          model: manifest.model,
          max_tokens: MAX_TOKENS,
          system: ACCOUNT_AUDIT_SYSTEM_PROMPT,
          messages: [{ role: "user" as const, content: prepared.message }],
          output_config: { effort: manifest.effort as "high", format: { type: "json_schema" as const, schema: format.schema } },
        },
      };
    }),
  });
  manifest.batches.push({ id: batch.id, createdAt: new Date().toISOString(), customIds: targets.map((c) => c.customId) });
  saveManifest(dir, manifest);
  console.log(`Lote creado: ${batch.id} (${batch.processing_status}). Después: pnpm audit:accounts -- collect --run ${path.basename(dir)} --wait`);
}

function sanitize(output: AccountAuditOutput, refs: Record<string, string>): AccountAuditOutput {
  const seen = new Set<string>();
  return {
    ...output,
    accionables: output.accionables.filter((v) => refs[v.ref] && !seen.has(v.ref) && seen.add(v.ref)).map((v) => ({ ...v, duplicado_de: v.duplicado_de && refs[v.duplicado_de] && v.duplicado_de !== v.ref ? v.duplicado_de : null })),
    preguntas: output.preguntas.map((q) => ({ ...q, ref: q.ref && refs[q.ref] ? q.ref : null })),
  };
}

async function collect() {
  const dir = runDir();
  const manifest = readManifest(dir);
  const anthropic = new Anthropic();
  manifest.collected ??= {};
  const byCustom = new Map(manifest.clients.map((c) => [c.customId, c]));
  for (const b of manifest.batches) {
    let batch = await anthropic.messages.batches.retrieve(b.id);
    while (batch.processing_status !== "ended" && flag("wait")) {
      console.log(`${b.id}: ${batch.processing_status} · procesando ${batch.request_counts.processing} · listos ${batch.request_counts.succeeded}`);
      await new Promise((r) => setTimeout(r, 30_000));
      batch = await anthropic.messages.batches.retrieve(b.id);
    }
    if (batch.processing_status !== "ended") {
      console.log(`${b.id}: ${batch.processing_status} (procesando ${batch.request_counts.processing}). Volvé a correr collect más tarde o con --wait.`);
      continue;
    }
    for await (const res of await anthropic.messages.batches.results(b.id)) {
      if (manifest.collected[res.custom_id]?.saved) continue;
      const c = byCustom.get(res.custom_id);
      if (!c) continue;
      const prepared: Prepared = JSON.parse(readFileSync(path.join(dir, c.file), "utf8"));
      const meta = { clientId: c.clientId, clientName: c.clientName, trigger: "auditoria", batch: true };
      if (res.result.type !== "succeeded") {
        manifest.collected[res.custom_id] = { at: new Date().toISOString(), ok: false, error: res.result.type, input: 0, output: 0, costUsd: 0 };
        console.log(`✗ ${c.clientName}: ${res.result.type}${res.result.type === "errored" ? ` ${JSON.stringify(res.result.error).slice(0, 200)}` : ""}`);
        continue;
      }
      const msg = res.result.message;
      const usage = msg.usage;
      const costUsd = estimateCost({ model: manifest.model, input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, batch: true }) ?? 0;
      let output: AccountAuditOutput | null = null;
      let error: string | undefined;
      if (msg.stop_reason === "refusal") error = "modelo_rechazo";
      else if (msg.stop_reason === "max_tokens") error = "respuesta_cortada";
      else {
        const text = msg.content.flatMap((blk) => (blk.type === "text" ? [blk.text] : [])).join("");
        try {
          output = sanitize(format.parse(text), prepared.refs);
        } catch (e) {
          error = `json_invalido: ${(e as Error).message.slice(0, 200)}`;
        }
      }
      // Una sola entrada de consumo por cuenta y corrida (aunque collect se repita tras un fallo).
      const logged = (await getAIUsage()).some((e) => e.kind === "audit" && e.clientId === c.clientId && e.at >= manifest.createdAt);
      if (!logged) await recordAIUsage("audit", manifest.model, usage, meta, { ok: !!output, stop: msg.stop_reason });
      manifest.collected[res.custom_id] = { at: new Date().toISOString(), ok: !!output, ...(error && { error }), input: usage.input_tokens, output: usage.output_tokens, costUsd };
      saveManifest(dir, manifest);
      if (!output) {
        console.log(`✗ ${c.clientName}: ${error} · ${usd(costUsd)}`);
        continue;
      }
      writeFileSync(path.join(dir, `${c.customId}.output.json`), JSON.stringify(output, null, 2), "utf8");
      const missing = Object.keys(prepared.refs).filter((r) => !output!.accionables.some((v) => v.ref === r));
      await setAccountAudit(c.clientId, {
        generatedAt: new Date().toISOString(),
        model: manifest.model,
        refs: prepared.refs,
        refTexts: prepared.texts,
        output,
        meetingsRead: prepared.meetingsRead,
        threadsRead: prepared.threadsRead,
        partnerThreadsRead: prepared.partnerThreadsRead,
      });
      manifest.collected[res.custom_id].saved = true;
      saveManifest(dir, manifest);
      const counts = output.accionables.reduce<Record<string, number>>((m, v) => ((m[v.veredicto] = (m[v.veredicto] ?? 0) + 1), m), {});
      console.log(
        `✓ ${c.clientName.padEnd(22)} ${JSON.stringify(counts)} · faltantes ${output.faltantes.length} · preguntas ${output.preguntas.length}${missing.length ? ` · SIN VEREDICTO ${missing.join(",")}` : ""} · ${usage.input_tokens}/${usage.output_tokens} tokens · ${usd(costUsd)}`,
      );
    }
  }
  saveManifest(dir, manifest);
  const total = Object.values(manifest.collected).reduce((n, c) => n + c.costUsd, 0);
  console.log(`\nGasto de la auditoría hasta ahora (estimado, lote): ${usd(total)}`);
}

async function report() {
  const dir = runDir();
  const manifest = readManifest(dir);
  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const ids = new Set(manifest.clients.map((c) => c.clientId));
  const views = file.clients.filter((c) => ids.has(c.id)).flatMap((c) => {
    const v = auditView(c, settings);
    return v ? [v] : [];
  });
  const KIND: Record<string, string> = { done: "Hecho", remove: "Quitar", side: "Lado", edit: "Reescribir", due: "Fecha", add: "Nuevo", profile: "Perfil", question: "Pregunta" };
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auditoría de cuentas</title><style>
:root{--bg:#f4f4f5;--card:#fff;--fg:#18181b;--muted:#71717a;--border:#e4e4e7}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--fg:#fafafa;--muted:#a1a1aa;--border:#3f3f46}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:16px}h2{margin:0 0 6px;font-size:17px}
.muted{color:var(--muted);font-size:12px}table{border-collapse:collapse;width:100%}td,th{text-align:left;vertical-align:top;padding:6px;border-bottom:1px solid var(--border)}
th{font-size:11px;text-transform:uppercase;color:var(--muted)}.k{font-weight:600;white-space:nowrap}.alta{color:#16a34a}.media{color:#d97706}.baja{color:#dc2626}
</style></head><body><main><h1>Auditoría de cuentas</h1><p class="muted">${esc(manifest.model)} · esfuerzo ${esc(manifest.effort)} · ${views.length} cuentas</p>
${views
  .map(
    (v) => `<div class="card"><h2>${esc(v.clientName)}</h2><p>${esc(v.resumen)}</p>
<p class="muted">Etapa: ${esc(v.etapa || "—")} · Desarrolla: ${esc(DEV_LABEL[v.desarrollo.quien])} (${esc(v.desarrollo.detalle)}) · Rol PM: ${esc(v.rolPm)} · Próximo paso: ${esc(v.proximoPaso)}</p>
<p class="muted">${v.unchanged} vigentes sin cambios · ${v.proposals.length} propuestas</p>
<table><tr><th>Tipo</th><th>Ref</th><th>Actual</th><th>Propuesta</th><th>Conf.</th><th>Evidencia / motivo</th></tr>
${v.proposals.map((p) => `<tr><td class="k">${KIND[p.kind]}</td><td>${p.ref ?? ""}</td><td>${esc(p.current ?? "")}</td><td>${esc(p.proposal)}</td><td class="${p.confianza}">${p.confianza}</td><td>${esc(p.evidencia)}<div class="muted">${esc(p.motivo)}</div></td></tr>`).join("")}
</table>${v.contactos.length ? `<p class="muted">Contactos: ${v.contactos.map((c) => esc(`${c.nombre} (${c.empresa}, ${c.rol}) — ${c.nota}`)).join(" · ")}</p>` : ""}</div>`,
  )
  .join("")}
</main></body></html>`;
  const out = path.join(dir, "reporte.html");
  writeFileSync(out, html, "utf8");
  console.log(`Reporte: ${path.resolve(out)}`);
}

/**
 * Aplica en bloque las propuestas de una confianza (default alta) de todas las cuentas auditadas, igual que el botón
 * "Aplicar" del modal. Nunca aplica preguntas ni cambios de perfil (quién desarrolla / ERP: los valida el PM).
 *   apply [--confianza alta] [--kinds done,remove,side,edit,add,due] [--exclude "Cuenta|A7:side,..."] [--dry-run]
 * Deja el detalle en .data/audit/aplicado-<fecha-hora>.json.
 */
async function apply() {
  const conf = arg("confianza") ?? "alta";
  const kinds = (arg("kinds") ?? "done,remove,side,edit,add,due").split(",").filter((k) => k !== "profile" && k !== "question");
  const exclude = new Set((arg("exclude") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const dry = flag("dry-run");
  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const log: { client: string; key: string; kind: string; current: string | null; proposal: string; evidencia: string }[] = [];
  for (const c of file.clients.filter((x) => x.status === "assigned" && x.audit)) {
    const view = auditView(c, settings);
    for (const p of view?.proposals ?? []) {
      if (p.confianza !== conf || !kinds.includes(p.kind)) continue;
      if (exclude.has(`${c.name}|${p.key}`.toLowerCase()) || exclude.has(`${c.id}|${p.key}`.toLowerCase())) {
        console.log(`  (excluida) ${c.name} ${p.key}`);
        continue;
      }
      if (!dry) {
        const ok = await resolveAudit(c.id, { key: p.key, kind: p.kind, ticketId: p.ticketId, ...p.apply }, "apply");
        if (!ok) {
          console.log(`✗ ${c.name} ${p.key}: no se pudo aplicar`);
          continue;
        }
      }
      log.push({ client: c.name, key: p.key, kind: p.kind, current: p.current, proposal: p.proposal, evidencia: p.evidencia });
      console.log(`${dry ? "·" : "✓"} ${c.name.padEnd(20)} ${p.key.padEnd(10)} ${p.proposal.slice(0, 90)}`);
    }
  }
  if (!dry && log.length) {
    const out = path.join(".data", "audit", `aplicado-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}.json`);
    writeFileSync(out, JSON.stringify(log, null, 2), "utf8");
    console.log(`Registro: ${out}`);
  }
  console.log(`${dry ? "Se aplicarían" : "Aplicadas"}: ${log.length}`);
}

const cmd = process.argv.slice(2).find((a) => !a.startsWith("--") && ["prepare", "submit", "collect", "report", "apply"].includes(a));
const run = { prepare, submit, collect, report, apply }[cmd ?? ""];
if (!run) {
  console.error("Uso: pnpm audit:accounts -- prepare|submit|collect|report|apply [...]");
  const audits = existsSync(path.join(".data", "audit")) ? readdirSync(path.join(".data", "audit")) : [];
  if (audits.length) console.error(`Corridas: ${audits.join(", ")}`);
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
