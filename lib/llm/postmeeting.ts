import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildSystemPrompt } from "@/lib/llm/postmeeting-prompt";
import { recordResponse, type UsageMeta } from "@/lib/store/ai-usage-store";
import { PostMeetingSchema, type PostMeetingOutput } from "@/lib/llm/postmeeting-schema";

// Única llamada al modelo de la app: minuta + transcripción → JSON fijo (`PostMeetingSchema`).
// Si no hay clave o falla, quien llama sigue con el armado por reglas (nunca bloquea el mail).

export const DEFAULT_POSTMEETING_MODEL = "claude-sonnet-5-5";

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const postMeetingModel = () => process.env.ANTHROPIC_MODEL || DEFAULT_POSTMEETING_MODEL;

export interface PostMeetingInput {
  clientName: string;
  ownCompany: string;
  /** "miércoles 11/11/2026" */
  meetingDate: string;
  meetingTitle: string;
  ownerName: string;
  participants: { name: string; email: string | null; company: string }[];
  openActionables: string[];
  corrections: { from: string; to: string }[];
  erp?: string | null;
  /** Tiempos de referencia del PM por tipo de tarea (`guideText`). */
  estimateGuide?: string;
  notes: string | null;
  transcript: string | null;
}

const block = (tag: string, text: string | null) => (text?.trim() ? `<${tag}>\n${text.trim()}\n</${tag}>` : `<${tag}>(no disponible)</${tag}>`);

export function buildUserMessage(input: PostMeetingInput): string {
  const context = [
    `Cliente: ${input.clientName}`,
    `Nuestra empresa: ${input.ownCompany}`,
    `PM de ${input.ownCompany} (yo): ${input.ownerName}`,
    `Reunión: ${input.meetingTitle}`,
    `Fecha de la reunión: ${input.meetingDate}`,
    ...(input.erp ? [`ERP del cliente: ${input.erp}`] : []),
    ...(input.estimateGuide ? [`Tiempos de referencia del PM: ${input.estimateGuide}`] : []),
    "Participantes:",
    ...(input.participants.length
      ? input.participants.map((p) => `- ${p.name}${p.email ? ` <${p.email}>` : ""} (${p.company})`)
      : ["- (sin datos del calendario: deducilos de las notas)"]),
    ...(input.corrections.length
      ? ["Correcciones de nombres conocidas:", ...input.corrections.map((c) => `- "${c.from}" → "${c.to}"`)]
      : []),
    "Accionables abiertos de reuniones anteriores:",
    ...(input.openActionables.length ? input.openActionables.map((a) => `- ${a}`) : ["- (ninguno)"]),
  ].join("\n");
  return [block("contexto", context), block("notas", input.notes), block("transcripcion", input.transcript)].join("\n\n");
}

export async function generatePostMeeting(input: PostMeetingInput, meta?: UsageMeta): Promise<PostMeetingOutput> {
  if (!input.notes?.trim() && !input.transcript?.trim()) throw new Error("sin_notas_ni_transcripcion");
  const client = new Anthropic();
  const model = postMeetingModel();
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(input) }],
    output_config: { format: zodOutputFormat(PostMeetingSchema) },
  });
  await recordResponse("postmeeting", model, response, meta);
  if (response.stop_reason === "refusal") throw new Error("modelo_rechazo");
  if (response.stop_reason === "max_tokens") throw new Error("respuesta_cortada");
  if (!response.parsed_output) throw new Error("json_invalido");
  return response.parsed_output;
}
