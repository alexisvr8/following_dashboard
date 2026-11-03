// Parser por reglas (sin LLM) de minutas "Notes by Gemini" / "Notas de Gemini".
// Extrae del Resumen el primer párrafo y los temas tratados (hitos), las decisiones y los bullets
// de "Próximos pasos".

const NEXT_STEPS_HEADING = /^(pr[oó]ximos pasos( sugeridos)?|suggested next steps|next steps|action items)\s*:?$/i;
const SUMMARY_HEADING = /^(resumen|summary)\s*:?$/i;
const DECISIONS_HEADING = /^(decisiones|decisions)\s*:?$/i;
const AGREED_STATUS = /^(acordad[ao]s?|agreed)\s*:?$/i;
// Headings conocidos de Gemini: cortan la sección actual.
const ANY_HEADING =
  /^(resumen|summary|decisiones|decisions|detalles|details|pr[oó]ximos pasos( sugeridos)?|suggested next steps|next steps|action items|transcripci[oó]n|transcript|notas|notes|archivos adjuntos|attachments|invitados|invited)\s*:?$/i;
const BULLET = /^\s*(\[\s?\]|☐|□|[-*•●▪◦]|\d+[.)])\s+/;
const MAX_MILESTONES = 6;

export interface MeetingDecision {
  text: string;
  /** true = "Acordada"; false = quedó abierta ("Requiere más debate"). */
  agreed: boolean;
}

export interface ParsedGeminiNotes {
  summary: string | null;
  nextSteps: string[];
  /** Temas tratados de la reunión: "Título: detalle". */
  milestones: string[];
  decisions: MeetingDecision[];
}

export interface StepDue {
  label: string;
  /** Último día que cubre la fecha (fin del día; para detectar si ya venció). */
  until: Date;
}

export interface ParsedStep {
  owners: string[];
  text: string;
  due: StepDue | null;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const pad = (n: number) => String(n).padStart(2, "0");
const ddmm = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 23, 59, 59);
const dayLabel = (d: Date) => `${WEEKDAYS[d.getDay()].slice(0, 3)} ${ddmm(d)}`;

/** Fecha sin año ("12/11", "12 de noviembre"): la primera ocurrencia desde la reunión. */
function dateFrom(day: number, month: number, base: Date): Date {
  const candidate = new Date(base.getFullYear(), month, day, 23, 59, 59);
  return candidate < base ? new Date(base.getFullYear() + 1, month, day, 23, 59, 59) : candidate;
}

/** Fecha objetivo mencionada en un próximo paso, resuelta contra la fecha de la reunión. */
export function parseDue(text: string, meetingDate: string): StepDue | null {
  const base = new Date(meetingDate);
  const t = stripAccents(text.toLowerCase());

  if (/\b(semana proxima|proxima semana|semana que viene|semana siguiente)\b/.test(t)) {
    const monday = addDays(base, ((8 - base.getDay()) % 7) || 7);
    return { label: `semana del ${ddmm(monday)}`, until: addDays(monday, 6) };
  }
  const numeric = t.match(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/);
  if (numeric && +numeric[1] >= 1 && +numeric[1] <= 31 && +numeric[2] >= 1 && +numeric[2] <= 12) {
    const d = dateFrom(+numeric[1], +numeric[2] - 1, base);
    return { label: ddmm(d), until: d };
  }
  const named = t.match(new RegExp(`\\b(\\d{1,2}) de (${MONTHS.join("|")})\\b`));
  if (named) {
    const d = dateFrom(+named[1], MONTHS.indexOf(named[2]), base);
    return { label: ddmm(d), until: d };
  }
  const weekday = t.match(/\b(?:el|este|proximo|dia|para el|hasta el|antes del)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekday) {
    const d = addDays(base, ((WEEKDAYS.indexOf(weekday[1]) - base.getDay() + 7) % 7) || 7);
    return { label: dayLabel(d), until: d };
  }
  // "mañana" como día, no como momento del día ("el lunes por la mañana").
  if (/(?<!(por|de|a|en) la )\bmanana\b/.test(t)) {
    const d = addDays(base, 1);
    return { label: dayLabel(d), until: d };
  }
  return null;
}

/** "[Ana Pérez, Luis] Enviar X: detalle" → dueños, texto y fecha objetivo. */
export function parseStep(step: string, meetingDate: string): ParsedStep {
  const m = step.match(/^\s*\[([^\]]+)\]\s*(.+)$/);
  const text = (m ? m[2] : step).trim();
  return {
    owners: m ? m[1].split(",").map((o) => o.trim()).filter(Boolean) : [],
    text,
    due: parseDue(text, meetingDate),
  };
}

/** Párrafos del Resumen: el primero es el resumen; cada siguiente es "Título" + detalle. */
function paragraphs(lines: string[]): string[][] {
  const out: string[][] = [[]];
  for (const l of lines) {
    if (l) out.at(-1)!.push(l);
    else if (out.at(-1)!.length) out.push([]);
  }
  return out.filter((p) => p.length);
}

function parseDecisions(lines: string[]): MeetingDecision[] {
  const decisions: MeetingDecision[] = [];
  let agreed = true;
  for (const line of lines) {
    if (!line) continue;
    if (!BULLET.test(line)) {
      agreed = AGREED_STATUS.test(line);
      continue;
    }
    const raw = line.replace(BULLET, "").trim();
    // Gemini pega título y frase: "Casos de prueba Se acordó crear…" → solo la frase.
    const text = raw.match(/\s(Se\s+\p{L}+\s.*)$/u)?.[1] ?? raw;
    if (text.length > 2) decisions.push({ text, agreed });
  }
  return decisions;
}

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.trim());
}

function sectionAfter(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => ANY_HEADING.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

export function parseGeminiNotes(text: string): ParsedGeminiNotes {
  const lines = normalizeLines(text);

  const nextStepsSection = sectionAfter(lines, NEXT_STEPS_HEADING).filter(Boolean);
  const bullets = nextStepsSection.filter((l) => BULLET.test(l));
  // Si Gemini no usó viñetas, cada línea no vacía es un paso.
  const nextSteps = (bullets.length ? bullets : nextStepsSection)
    .map((l) => l.replace(BULLET, "").trim())
    .filter((l) => l.length > 2);

  const [firstParagraph = [], ...topics] = paragraphs(sectionAfter(lines, SUMMARY_HEADING));
  const summary = firstParagraph.join(" ").trim();
  const milestones = topics.map(([title, ...detail]) =>
    detail.length ? `${title.replace(/[:.]$/, "")}: ${detail.join(" ")}` : title,
  );

  return {
    summary: summary ? summary.slice(0, 600) : null,
    nextSteps: [...new Set(nextSteps)],
    milestones: [...new Set(milestones)].slice(0, MAX_MILESTONES),
    decisions: parseDecisions(sectionAfter(lines, DECISIONS_HEADING)),
  };
}
