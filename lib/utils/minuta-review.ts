// Validación de accionables al enviar la minuta post-reunión: compara las líneas de accionables que armó la app
// (`FollowupDraft.minutaItems`, con su ticket) con el texto que realmente sale (editado en la app o en Gmail).
// Punto que sacaste → No corresponde (default) / Hecho / Sigue abierto; punto que pasaste a "Hecho" (status o
// sección "Ya avanzamos") → se tilda; punto nuevo en Accionables → opción de crear el accionable.
// Puro (sin node:*): lo usan el composer (antes de enviar) y la sync (mail enviado desde Gmail).
import { keywordSimilarity } from "@/lib/utils/mail-classify";

/** Línea de accionable del borrador generado, con el ticket que la originó. */
export interface MinutaItem {
  ticketId: string;
  line: string;
  /** Ya estaba hecho al generarlo (va en "Ya avanzamos con"). */
  done: boolean;
}

export interface MinutaLine {
  /** Texto del punto sin responsable ni status ("Título: detalle"). */
  text: string;
  title: string;
  owner: string | null;
  done: boolean;
}

export type MinutaChangeKind = "removed" | "marked_done" | "added";

export interface MinutaChange {
  /** Estable dentro del mail (para el estado de la UI y los ids de la revisión). */
  key: string;
  kind: MinutaChangeKind;
  ticketId?: string;
  title: string;
  detail?: string;
  owner?: string | null;
}

export type MinutaAction = "done" | "not_applicable" | "keep" | "create" | "ignore";

/** Lo que se aplica si no tocás nada: sacado → No corresponde; marcado hecho → Hecho; agregado → nada. */
export const DEFAULT_ACTION: Record<MinutaChangeKind, MinutaAction> = {
  removed: "not_applicable",
  marked_done: "done",
  added: "ignore",
};

/** Mismo punto aunque lo hayas reescrito un poco. */
const SAME_ITEM = 0.5;

const STATUS_RE = /\s*-\s*\**\s*Status:\**\s*(.+?)\s*$/i;
const BULLET_RE = /^\s*(?:[•✓*\-–]|\d{1,2}[.)])\s+/;

type Section = "open" | "done" | "other";

function sectionOf(line: string): Section | null {
  const t = line.replace(/[*_]/g, "").trim();
  if (!/:\s*$/.test(t) || BULLET_RE.test(line)) return null;
  if (/ya avanzamos/i.test(t)) return "done";
  if (/accionables|^de parte de\b|^de nuestro lado\b/i.test(t)) return "open";
  // Otro título ("📌 Puntos importantes:", "Lo que charlamos:"): corta la sección de accionables.
  if (t.length <= 60) return "other";
  return null;
}

function parseLine(raw: string, section: Section): MinutaLine {
  let s = raw.replace(BULLET_RE, "").replace(/\*+/g, "").replace(/\s+/g, " ").trim();
  let status = "";
  const st = s.match(STATUS_RE);
  if (st) {
    status = st[1];
    s = s.slice(0, st.index).trim();
  }
  let owner: string | null = null;
  const ow = s.match(/\s*\(([^()]{1,60})\)\s*$/);
  if (ow) {
    owner = ow[1].trim();
    s = s.slice(0, ow.index).trim();
  }
  const text = s.replace(/\s*\.+$/, "").trim();
  const title = (text.split(":")[0] ?? text).trim().slice(0, 120);
  return { text, title, owner, done: /hecho|✅/i.test(status) || section === "done" };
}

/**
 * Puntos de las secciones "🚀 Accionables" (y sus franjas por lado) y "✅ Ya avanzamos con" de un mail: acepta el
 * borrador de la app ("• …") y el texto plano de Gmail ("- …", "* …", líneas cortadas que siguen al punto).
 */
export function parseMinutaLines(body: string): MinutaLine[] {
  const lines = body.replace(/\r/g, "").split("\n");
  const out: { raw: string; section: Section }[] = [];
  let section: Section = "other";
  let current: { raw: string; section: Section } | null = null;
  for (const line of lines) {
    if (/^\s*>/.test(line) || /^(El|On) .{5,160}(escribió|wrote):\s*$/.test(line.trim())) break; // cita del mail anterior
    if (/^\s*saludos[.!,]?\s*$/i.test(line)) break;
    const head = sectionOf(line);
    if (head) {
      section = head;
      current = null;
      continue;
    }
    if (!line.trim()) {
      current = null;
      continue;
    }
    if (section === "other") continue;
    if (BULLET_RE.test(line)) {
      current = { raw: line, section };
      out.push(current);
    } else if (current) {
      current.raw += ` ${line.trim()}`; // continuación (Gmail corta el texto plano)
    }
  }
  return out.map((x) => parseLine(x.raw, x.section)).filter((l) => l.text.length >= 3);
}

const sim = (a: MinutaLine, b: MinutaLine) =>
  a.text.toLowerCase() === b.text.toLowerCase() ? 1 : Math.max(keywordSimilarity(a.text, b.text), keywordSimilarity(a.title, b.title) * 0.9);

const hashKey = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/**
 * Diferencias entre las líneas generadas y el texto final. Solo puntos que estaban abiertos al generar:
 * sacados → "removed"; pasados a hecho → "marked_done". Puntos nuevos en Accionables → "added".
 */
export function minutaChanges(items: MinutaItem[], finalBody: string): MinutaChange[] {
  const finals = parseMinutaLines(finalBody);
  const used = new Set<number>();
  const out: MinutaChange[] = [];
  const gens = items.map((it) => ({ it, line: parseMinutaLines(`Accionables:\n${it.line}`)[0] })).filter((g) => g.line);
  // Primero los idénticos, así una reescritura parecida no le roba el par a otro punto.
  const pairs = new Map<number, number>();
  for (const pass of [1, SAME_ITEM]) {
    gens.forEach((g, i) => {
      if (pairs.has(i)) return;
      let best = -1;
      let score = 0;
      finals.forEach((f, j) => {
        if (used.has(j)) return;
        const v = sim(g.line, f);
        if (v > score) {
          score = v;
          best = j;
        }
      });
      if (best >= 0 && score >= pass) {
        used.add(best);
        pairs.set(i, best);
      }
    });
  }
  gens.forEach((g, i) => {
    if (g.it.done) return; // ya estaba cerrado: sacarlo del mail o reabrirlo no cambia el tablero
    const detail = g.line.text.includes(":") ? g.line.text.split(":").slice(1).join(":").trim() : undefined;
    const base = { ticketId: g.it.ticketId, title: g.line.title, detail, owner: g.line.owner };
    const j = pairs.get(i);
    if (j === undefined) out.push({ key: `removed:${g.it.ticketId}`, kind: "removed", ...base });
    else if (finals[j].done) out.push({ key: `marked_done:${g.it.ticketId}`, kind: "marked_done", ...base });
  });
  finals.forEach((f, j) => {
    if (used.has(j) || f.done || f.text.length < 12) return;
    const detail = f.text.includes(":") ? f.text.split(":").slice(1).join(":").trim() : undefined;
    out.push({ key: `added:${hashKey(f.text)}`, kind: "added", title: f.title, detail, owner: f.owner });
  });
  return out;
}

/** Texto del accionable a crear desde un punto agregado ("[Dueño] Título: detalle"). */
export const addedTitle = (c: Pick<MinutaChange, "title" | "detail" | "owner">) =>
  `${c.owner ? `[${c.owner}] ` : ""}${c.title}${c.detail ? `: ${c.detail}` : ""}`;
