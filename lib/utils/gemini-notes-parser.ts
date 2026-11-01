// Parser por reglas (sin LLM) de minutas "Notes by Gemini" / "Notas de Gemini".
// Extrae el primer párrafo del resumen y los bullets de "Próximos pasos".

const NEXT_STEPS_HEADING = /^(pr[oó]ximos pasos( sugeridos)?|suggested next steps|next steps|action items)\s*:?$/i;
const SUMMARY_HEADING = /^(resumen|summary)\s*:?$/i;
// Headings conocidos de Gemini: cortan la sección actual.
const ANY_HEADING =
  /^(resumen|summary|detalles|details|pr[oó]ximos pasos( sugeridos)?|suggested next steps|next steps|action items|transcripci[oó]n|transcript|notas|notes|archivos adjuntos|attachments|invitados|invited)\s*:?$/i;
const BULLET = /^\s*(\[\s?\]|☐|□|[-*•●▪◦]|\d+[.)])\s+/;

export interface ParsedGeminiNotes {
  summary: string | null;
  nextSteps: string[];
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

  const summaryLines = sectionAfter(lines, SUMMARY_HEADING);
  const firstParagraph: string[] = [];
  for (const l of summaryLines) {
    if (!l) {
      if (firstParagraph.length) break;
      continue;
    }
    firstParagraph.push(l);
  }
  const summary = firstParagraph.join(" ").trim();

  return {
    summary: summary ? summary.slice(0, 600) : null,
    nextSteps: [...new Set(nextSteps)],
  };
}
