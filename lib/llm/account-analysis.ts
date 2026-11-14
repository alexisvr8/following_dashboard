import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ACCOUNT_ANALYSIS_SYSTEM_PROMPT } from "@/lib/llm/account-analysis-prompt";
import { AccountAnalysisSchema, type AccountAnalysisOutput } from "@/lib/llm/account-analysis-schema";
import { postMeetingModel } from "@/lib/llm/postmeeting";
import { recordResponse, type UsageMeta } from "@/lib/store/ai-usage-store";

// Análisis semanal de UNA cuenta: última reunión + tablero + trazabilidad completa de mails → JSON fijo
// (`AccountAnalysisSchema`). Mismo modelo y clave que el mail post-reunión (`ANTHROPIC_MODEL`).

export type AnalysisBasis = "reunion" | "mails";
export type MailWho = "cliente" | "yo" | "equipo";

export interface AnalysisMail {
  from: string;
  fromName: string | null;
  who: MailWho;
  /** ISO */
  date: string;
  to: string[];
  text: string;
}

export interface AnalysisThread {
  subject: string;
  messages: AnalysisMail[];
}

export interface AnalysisOpenItem {
  ref: string;
  title: string;
  detail: string | null;
  side: "debo" | "me_deben";
  owners: string[];
  /** "vie 14/11 (acordada)" */
  due: string;
  origin: string;
  /** El texto se puede editar (minuta o propio): admite reescritura. */
  rewritable: boolean;
}

export interface AnalysisInput {
  clientName: string;
  ownCompany: string;
  ownerName: string;
  /** "lunes 16/11/2026" */
  today: string;
  erp: string | null;
  manualPriority: string | null;
  /** Cuenta "Más atención" (cliente exigente). */
  attention: boolean;
  /** "mails y seguimiento 15 min · revisar 20 min · …" (tiempos de referencia del PM). */
  estimateGuide?: string;
  notes: string | null;
  basis: AnalysisBasis;
  /** "02/11/2026": desde cuándo se leyeron los mails. */
  periodFrom: string;
  nextMeeting: string | null;
  meeting: {
    title: string;
    date: string;
    objetivo: string | null;
    puntos: string[];
    charlamos: string[];
    summary: string | null;
    steps: { text: string; done: boolean }[];
  } | null;
  open: AnalysisOpenItem[];
  closed: { title: string; doneAt: string }[];
  threads: AnalysisThread[];
}

const dmy = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const block = (tag: string, lines: string[]) =>
  lines.length ? `<${tag}>\n${lines.join("\n")}\n</${tag}>` : `<${tag}>(nada)</${tag}>`;

export function buildAnalysisMessage(input: AnalysisInput): string {
  const cuenta = [
    `Cliente: ${input.clientName}`,
    `Nuestra empresa: ${input.ownCompany}`,
    `PM (yo): ${input.ownerName}`,
    `Hoy: ${input.today}`,
    `Base del análisis: ${input.basis}`,
    `Mails leídos desde: ${input.periodFrom}`,
    `Próxima reunión agendada: ${input.nextMeeting ?? "ninguna"}`,
    ...(input.erp ? [`ERP: ${input.erp}`] : []),
    ...(input.attention ? ["MÁS ATENCIÓN: cliente exigente marcado por el PM (ver reglas)"] : []),
    ...(input.estimateGuide ? [`Tiempos de referencia del PM: ${input.estimateGuide}`] : []),
    ...(input.manualPriority ? [`Prioridad marcada por el PM: ${input.manualPriority}`] : []),
    ...(input.notes ? [`Notas del PM: ${input.notes}`] : []),
  ];
  const m = input.meeting;
  const reunion = m
    ? [
        `Título: ${m.title}`,
        `Fecha: ${dmy(m.date)}`,
        ...(m.objetivo ? [`Objetivo: ${m.objetivo}`] : []),
        ...(m.summary && !m.charlamos.length ? [`Resumen: ${m.summary}`] : []),
        ...(m.puntos.length ? ["Temas:", ...m.puntos.map((p) => `- ${p}`)] : []),
        ...(m.charlamos.length ? ["Lo que se charló:", ...m.charlamos.map((p) => `- ${p}`)] : []),
        ...(m.steps.length ? ["Accionables de la minuta:", ...m.steps.map((s) => `- [${s.done ? "hecho" : "pendiente"}] ${s.text}`)] : []),
      ]
    : [];
  const abiertos = input.open.map(
    (a) =>
      `${a.ref} | ${a.side} | ${a.owners.join(", ") || "sin responsable"} | ${a.title}${a.detail ? `: ${a.detail}` : ""} | plazo ${a.due} | origen ${a.origin}${a.rewritable ? " | reescribible" : ""}`,
  );
  const cerrados = input.closed.map((c) => `- ${c.title} (hecho ${dmy(c.doneAt)})`);
  const mails = input.threads.flatMap((t, i) => [
    `## Hilo ${i + 1}: ${t.subject}`,
    ...t.messages.map(
      (msg) =>
        `--- ${dmy(msg.date)} · ${msg.who.toUpperCase()} · ${msg.fromName ? `${msg.fromName} <${msg.from}>` : msg.from} → ${msg.to.join(", ") || "-"}\n${msg.text.trim() || "(sin texto)"}`,
    ),
    "",
  ]);
  return [
    block("cuenta", cuenta),
    block("ultima_reunion", reunion),
    block("accionables_abiertos", abiertos),
    block("cerrados_recientes", cerrados),
    block("mails", mails),
  ].join("\n\n");
}

export interface AnalysisUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export async function generateAccountAnalysis(input: AnalysisInput, meta?: UsageMeta): Promise<{ output: AccountAnalysisOutput; usage: AnalysisUsage }> {
  const client = new Anthropic();
  const model = postMeetingModel();
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: ACCOUNT_ANALYSIS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildAnalysisMessage(input) }],
    output_config: { format: zodOutputFormat(AccountAnalysisSchema) },
  });
  await recordResponse("analysis", model, response, meta);
  if (response.stop_reason === "refusal") throw new Error("modelo_rechazo");
  if (response.stop_reason === "max_tokens") throw new Error("respuesta_cortada");
  if (!response.parsed_output) throw new Error("json_invalido");
  return { output: response.parsed_output, usage: response.usage };
}
