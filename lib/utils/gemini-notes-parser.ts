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

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

/** Si cae en día no laborable, pasa al siguiente día hábil (fin de día). */
export function rollToWorkday(d: Date, workDays: number[] = DEFAULT_WORK_DAYS): Date {
  const out = addDays(d, 0);
  for (let i = 0; i < 7 && workDays.length && !workDays.includes(out.getDay()); i++) out.setDate(out.getDate() + 1);
  return out;
}

/** `n` días hábiles después de `d` (n = 0 → el mismo día, o el siguiente hábil). Fin de día. */
export function addBusinessDays(d: Date, n: number, workDays: number[] = DEFAULT_WORK_DAYS): Date {
  const out = rollToWorkday(d, workDays);
  for (let left = n; left > 0 && workDays.length; ) {
    out.setDate(out.getDate() + 1);
    if (workDays.includes(out.getDay())) left--;
  }
  return out;
}

/** Último día hábil de la semana (lun–dom) que contiene `d`. */
function lastWorkdayOfWeek(d: Date, workDays: number[]): Date {
  const sunday = addDays(d, (7 - d.getDay()) % 7);
  for (let i = 0; i < 7; i++) {
    const x = addDays(sunday, -i);
    if (workDays.includes(x.getDay())) return x;
  }
  return sunday;
}

function lastWorkdayOfMonth(d: Date, workDays: number[]): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  for (let i = 0; i < 7; i++) {
    const x = addDays(last, -i);
    if (workDays.includes(x.getDay())) return x;
  }
  return last;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15,
};
const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
const toNum = (s: string) => NUMBER_WORDS[s] ?? Number(s);
const NEXT_WEEK = /\b(semana proxima|proxima semana|semana que viene|semana siguiente|next week)\b/;

/**
 * Fecha objetivo mencionada en un próximo paso, resuelta contra la fecha de la REUNIÓN (lo que se dijo
 * ese día), no contra hoy. Las fechas que caen en día no laborable pasan al siguiente día hábil.
 * Sin una fecha dicha devuelve `null`: nunca se inventa (la meta interna la pone `deadlines.ts`).
 */
export function parseDue(text: string, meetingDate: string, workDays: number[] = DEFAULT_WORK_DAYS): StepDue | null {
  const base = new Date(meetingDate);
  const t = stripAccents(text.toLowerCase());
  const day = (d: Date): StepDue => {
    const r = rollToWorkday(d, workDays);
    return { label: dayLabel(r), until: r };
  };

  const numeric = t.match(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/);
  if (numeric && +numeric[1] >= 1 && +numeric[1] <= 31 && +numeric[2] >= 1 && +numeric[2] <= 12) {
    return day(dateFrom(+numeric[1], +numeric[2] - 1, base));
  }
  const named = t.match(new RegExp(`\\b(\\d{1,2}) de (${MONTHS.join("|")})\\b`));
  if (named) return day(dateFrom(+named[1], MONTHS.indexOf(named[2]), base));
  if (/\bpasado manana\b/.test(t)) return day(addDays(base, 2));
  // "mañana" como día, no como momento del día ("el lunes por la mañana").
  // "el día de mañana" = algún día (modismo), no mañana.
  if ((/(?<!(por|de|a|en) la )\bmanana\b/.test(t) && !/\bel dia (de )?manana\b/.test(t)) || /\btomorrow\b/.test(t)) {
    return day(addDays(base, 1));
  }
  // "hoy" suelto suele ser contexto ("lo que hoy falla"): solo cuenta como plazo explícito.
  if (/\b(para hoy|hoy mismo|en el dia de hoy|antes del fin del dia|today|eod)\b/.test(t)) return day(addDays(base, 0));

  // "el viernes pasado" es pasado: no es un plazo.
  const weekday = t.match(/\b(?:el|este|proximo|dia|para el|hasta el|antes del)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b(?!\s+pasado)/);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    if (NEXT_WEEK.test(t)) {
      // "el viernes de la semana que viene": ese día de la semana siguiente a la reunión.
      const monday = addDays(base, ((8 - base.getDay()) % 7) || 7);
      return day(addDays(monday, (target + 6) % 7));
    }
    return day(addDays(base, ((target - base.getDay() + 7) % 7) || 7));
  }

  const businessDays = t.match(new RegExp(`\\b(?:en|dentro de|en los proximos)\\s+${NUM}\\s+dias? (?:habiles|laborables)\\b`));
  if (businessDays) {
    const d = addBusinessDays(base, toNum(businessDays[1]), workDays);
    return { label: dayLabel(d), until: d };
  }
  const days = t.match(new RegExp(`\\b(?:en|dentro de|en los proximos)\\s+${NUM}\\s+dias?\\b`));
  if (days) return day(addDays(base, toNum(days[1])));
  const weeks = t.match(new RegExp(`\\b(?:en|dentro de)\\s+${NUM}\\s+semanas?\\b`));
  if (weeks) return day(addDays(base, 7 * toNum(weeks[1])));

  if (NEXT_WEEK.test(t)) {
    const monday = addDays(base, ((8 - base.getDay()) % 7) || 7);
    const end = lastWorkdayOfWeek(monday, workDays);
    return { label: `semana del ${ddmm(monday)}`, until: end };
  }
  if (/\b(esta semana|en la semana|fin de (la )?semana|antes del fin de semana|this week)\b/.test(t)) {
    const end = lastWorkdayOfWeek(base, workDays);
    return { label: dayLabel(end), until: end < base ? rollToWorkday(base, workDays) : end };
  }
  if (/\b(fin de mes|fines de mes|final de mes|fin del mes|cierre de mes|end of (the )?month)\b/.test(t)) {
    const end = lastWorkdayOfMonth(base, workDays);
    return { label: dayLabel(end), until: end };
  }
  return null;
}

/** "[Ana Pérez, Luis] Enviar X: detalle" → dueños, texto y fecha objetivo. */
export function parseStep(step: string, meetingDate: string, workDays?: number[]): ParsedStep {
  const m = step.match(/^\s*\[([^\]]+)\]\s*(.+)$/);
  const text = (m ? m[2] : step).trim();
  return {
    owners: m ? m[1].split(",").map((o) => o.trim()).filter(Boolean) : [],
    text,
    due: parseDue(text, meetingDate, workDays),
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
