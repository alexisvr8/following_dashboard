import { keywordSimilarity } from "@/lib/utils/mail-classify";

// Compromisos y pedidos dichos en la reunión (pestaña "Transcripción" del Doc de Gemini), por reglas.
// Solo frases de ENTREGA a la otra parte ("te paso", "les envío", "te confirmo", "quedamos en") o pedidos
// ("¿me podrías pasar…?"); se descartan las acciones en vivo de la demo ("voy a compartir pantalla") y lo
// que Gemini ya listó en Próximos pasos. Entran como SUGERIDOS: se aceptan o descartan en /accionables.
// El lado (debo / me deben) y la fecha se calculan al leer, con las personas y alias de settings.

export interface TranscriptTurn {
  speaker: string;
  text: string;
  ts: string;
  sec: number;
}

export interface TranscriptSuggestion {
  /** Estable: id de la reunión + hash del turno. */
  id: string;
  speaker: string;
  /** Quién habló después (a quién se le pide / promete), si es otra persona. */
  addressee: string | null;
  ts: string;
  text: string;
  /** El turno + la respuesta corta del otro: donde buscar una fecha ("dale, el jueves"). */
  context: string;
  kind: "commit" | "ask";
  /** En el último cuarto de la reunión (repaso de acuerdos). */
  atClose: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const TRANSCRIPT_START = /^.*\s-\s(Transcripci[oó]n|Transcript)\s*$/m;
const TIMESTAMP = /^\d{2}:\d{2}:\d{2}$/;
const TURN = /^([A-ZÁÉÍÓÚÑ][^:]{1,40}):\s+(.*)$/;

/** Turnos de la transcripción; une los fragmentos que Gemini corta del mismo hablante en el mismo minuto. */
export function parseTranscript(doc: string): TranscriptTurn[] {
  const start = doc.search(TRANSCRIPT_START);
  if (start < 0) return [];
  const turns: TranscriptTurn[] = [];
  let ts = "00:00:00";
  for (const raw of doc.slice(start).split("\n")) {
    const line = raw.trim();
    if (TIMESTAMP.test(line)) {
      ts = line;
      continue;
    }
    const m = line.match(TURN);
    if (!m) continue;
    const last = turns.at(-1);
    if (last && last.speaker === m[1] && last.ts === ts) {
      last.text += ` ${m[2]}`;
    } else {
      const [h, mi, s] = ts.split(":").map(Number);
      turns.push({ speaker: m[1].trim(), text: m[2], ts, sec: h * 3600 + mi * 60 + s });
    }
  }
  return turns;
}

const DELIVER =
  /\b(te|les|le|se lo|se la|se los)\s+(voy a |vamos a )?(paso|pasamos|pasar|envio|enviamos|enviar|mando|mandamos|mandar|confirmo|confirmamos|confirmar|comparto|compartimos|compartir|aviso|avisamos|avisar|escribo|escribir|reenvio|reenviar|dejo|dejamos|dejar|habilito|habilitar|armo|armar|preparo|preparar)\b|\bquedamos (en|pendiente)/;
const ASK =
  /\b(me|nos)\s+(podrias|podrian|pasas|pasan|envias|envian|mandas|mandan|compartis|comparten|confirmas|confirman)\b|\b(podrias|podrian)\s+(enviar|mandar|pasar|compartir|confirmar)\b/;
// Acción en vivo durante la reunión, salvo que hable de un momento posterior.
const LIVE = /\b(pantalla|ahora mismo|un segundo|un segundito|ahi|aca)\b/;
const LATER = /\b(despues|luego|manana|semana|lunes|martes|miercoles|jueves|viernes|cuando)\b/;
// Despedidas y verbos en pasado ("le pasó", "te mandó"): no son compromisos.
const FAREWELL = /\b(abrazo|abrazos|saludo|saludos|beso|besos|buen dia|buen finde|buena semana)\b/;
const PAST = /(?<![\p{L}])(le|te|les|se lo|se la)\s+(pasó|envió|mandó|dejó|confirmó|compartió|avisó|escribió|armó|preparó)(?![\p{L}])/iu;
const MIN_LENGTH = 20;
const SAME = 0.4;
const MAX_PER_MEETING = 8;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Sugerencias de una minuta: compromisos/pedidos de la charla que no están en los Próximos pasos de Gemini. */
export function extractSuggestions(meetingId: string, doc: string, nextSteps: string[]): TranscriptSuggestion[] {
  const turns = parseTranscript(doc);
  if (!turns.length) return [];
  const end = turns.at(-1)!.sec || 1;
  const out: TranscriptSuggestion[] = [];
  turns.forEach((t, i) => {
    if (t.text.length < MIN_LENGTH) return;
    const tx = norm(t.text);
    if (FAREWELL.test(tx) || PAST.test(t.text)) return;
    const hit = tx.match(DELIVER);
    // "te dejo," sin decir qué: necesita contenido después del verbo.
    const rest = hit ? tx.slice((hit.index ?? 0) + hit[0].length).replace(/[^a-z0-9]+/g, "") : "";
    const commit = !!hit && rest.length >= 8 && !(LIVE.test(tx) && !LATER.test(tx));
    const ask = !commit && ASK.test(tx);
    if (!commit && !ask) return;
    if (nextSteps.some((s) => keywordSimilarity(s, t.text) >= SAME)) return;
    if (out.some((o) => o.speaker === t.speaker && keywordSimilarity(o.text, t.text) >= 0.6)) return;
    const next = turns.slice(i + 1, i + 4).find((x) => x.speaker !== t.speaker);
    // Fecha: en la propia frase o en la respuesta corta del otro ("dale, el jueves").
    const reply = turns[i + 1] && turns[i + 1].speaker !== t.speaker && turns[i + 1].text.length <= 90 ? turns[i + 1].text : "";
    out.push({
      id: `${meetingId}-tx-${hash(`${t.ts}|${t.speaker}|${t.text.slice(0, 60)}`)}`,
      speaker: t.speaker,
      addressee: next?.speaker ?? null,
      ts: t.ts,
      text: t.text.trim().slice(0, 400),
      context: `${t.text} ${reply}`.trim().slice(0, 600),
      kind: commit ? "commit" : "ask",
      atClose: t.sec >= end * 0.75,
    });
  });
  // Lo dicho al cierre (repaso de acuerdos) primero.
  return out.sort((a, b) => Number(b.atClose) - Number(a.atClose)).slice(0, MAX_PER_MEETING);
}

/** Reemplazo de palabra completa (sin tocar partes de otras palabras), sin distinguir mayúsculas. */
export function applyCorrections(text: string, corrections: { from: string; to: string }[]): string {
  let out = text;
  for (const { from, to } of corrections) {
    if (!from.trim()) continue;
    const escaped = from.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), to);
  }
  return out;
}
