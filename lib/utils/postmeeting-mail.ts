// Template único del mail post-reunión (con o sin IA). Estructura fija, en este orden:
// saludo → agradecimiento → 📌 Puntos importantes → 💬 Lo que charlamos → 🚀 Accionables (tabla en el HTML; De parte de {cliente} /
// De nuestro lado (Xtract)) → ✅ Ya avanzamos con → cierre → Saludos. Las secciones vacías se omiten.
// Viñetas "• " (las convierte `bodyToHtml`/`bodyToPlain`); cada accionable con " - Status: X" + emoji.

export type MailStatus = "Pendiente" | "En curso" | "Stand By" | "Hecho";

export const STATUS_PREFIX = " - Status: ";

/** " - Status: Pendiente ⏳" / " - Status: Stand By ⏳" / " - Status: Hecho ✅ (11/11)" */
export function statusSuffix(status: MailStatus, doneDay?: string | null): string {
  if (status === "Hecho") return `${STATUS_PREFIX}Hecho ✅${doneDay ? ` (${doneDay})` : ""}`;
  return `${STATUS_PREFIX}${status} ⏳`;
}

/** "Título: descripción" + punto final (sin duplicarlo). */
export const withPeriod = (text: string) => {
  const t = text.trim().replace(/\s*\.+$/, "");
  return t ? `${t}.` : t;
};

/** "• Título: Descripción. (Responsable) - Status: X emoji" (Pendiente ⏳ / En curso ⏳ / Stand By ⏳ / Hecho ✅ (dd/mm)). */
export function actionableLine(text: string, owner: string, status: MailStatus, doneDay?: string | null): string {
  return `• ${withPeriod(text)}${owner ? ` (${owner})` : ""}${statusSuffix(status, doneDay)}`;
}

/** Formato de una línea de accionable del mail (lo valida el test). */
export const ACTIONABLE_LINE_RE =
  /^• [^:]{2,80}: .+\. \([^()]+\) - Status: (Pendiente ⏳|En curso ⏳|Stand By ⏳|Hecho ✅( \(\d{2}\/\d{2}\))?)$/u;

/** Nombre del saludo de la IA ("Buen día Denise," → "Denise"); null si saluda al equipo o no hay saludo. */
export function greetingName(text: string): string | null {
  const m = text.match(/^\s*(?:buen(?:os)? d[ií]as?|buenas(?: tardes| noches)?|hola)\s+([^,\n]{1,40}),/i);
  const name = m?.[1].trim() ?? null;
  return name && !/^equipo\b/i.test(name) ? name : null;
}

const SINGULAR = /\b(te (dejo|comparto|paso|escribo|aviso)|me avisas|avisame|tienes|puedes|necesitas|quieres|ves)\b/i;
const PLURAL = /\b(les (dejo|comparto|paso|escribo|aviso)|me avisan|av[ií]senme|tienen|pueden|necesitan|quieren|ven)\b/i;

/** ¿El texto de la IA está en el trato del mail? (singular = una persona). Sin marcas claras, se da por bueno. */
export function matchesAddressing(text: string, singular: boolean): boolean {
  return singular ? !PLURAL.test(text) : !SINGULAR.test(text);
}

/** Saca un saludo inicial ("Buen día equipo,") del texto de la IA: el saludo lo pone la app según los destinatarios. */
export function stripGreeting(text: string): string {
  return text.replace(/^\s*(buen(os)? d[ií]as?|buenas( tardes| noches)?|hola)\b[^,\n]{0,40},\s*/i, "").trim();
}

export interface PostMeetingMail {
  greeting: string;
  thanks: string;
  puntos: string[];
  objetivo: string | null;
  charlamos: string[];
  clientName: string;
  /** Líneas ya armadas con `actionableLine`. */
  theirs: string[];
  ours: string[];
  done: string[];
  /** Líneas sueltas antes del cierre (p. ej. "Retomo en este hilo…"). */
  extra: string[];
  closing: string;
}

const bullet = (s: string) => `• ${s.trim()}`;

/** Salida del modelo → datos del template, sin cuenta ni hilo (vista previa y tests; la app usa `buildFollowup`). */
export function mailFromOutput(
  out: {
    dia_reunion: string;
    intro_mail?: string;
    cierre_mail?: string;
    objetivo: string;
    puntos_importantes: string[];
    lo_que_charlamos: string[];
    accionables: { titulo: string; resumen_mail: string; responsable: string; empresa: string; status: Exclude<MailStatus, "Hecho"> }[];
    ya_avanzamos: { titulo: string; resumen_mail: string; responsable: string; empresa: string; fecha: string | null }[];
  },
  client: string,
  me: string,
  meetingDay: string,
): string {
  const owner = (a: { responsable: string; empresa: string }) =>
    a.empresa === "ambas" ? `Xtract y ${client}` : a.empresa === "xtract" ? me : a.responsable.split(/\s+/)[0] || "Equipo";
  const line = (a: (typeof out.accionables)[number]) => actionableLine(`${a.titulo}: ${a.resumen_mail}`, owner(a), a.status);
  return renderPostMeetingMail({
    greeting: "Buen día equipo,",
    thanks: stripGreeting(out.intro_mail ?? "") || `Gracias por el espacio del ${out.dia_reunion}. Les dejo un resumen rápido de lo que charlamos y cómo seguimos:`,
    puntos: out.puntos_importantes,
    objetivo: null,
    charlamos: out.lo_que_charlamos,
    clientName: client,
    theirs: out.accionables.filter((a) => a.empresa !== "xtract").map(line),
    ours: out.accionables.filter((a) => a.empresa === "xtract").map(line),
    done: out.ya_avanzamos.map((a) => actionableLine(`${a.titulo}: ${a.resumen_mail}`, owner(a), "Hecho", a.fecha ?? meetingDay)),
    extra: [],
    closing: out.cierre_mail?.trim() || "Si ven algo distinto o quedó algún detalle afuera, me avisan.",
  });
}

export function renderPostMeetingMail(m: PostMeetingMail): string {
  const section = (title: string, rows: string[]) => (rows.length ? ["", title, ...rows] : []);
  // Sin IA, el objetivo (resumen de Gemini) encabeza "Lo que charlamos"; con IA los bullets ya lo cubren.
  const talked =
    m.objetivo || m.charlamos.length
      ? ["", "💬 Lo que charlamos:", ...(m.objetivo ? [m.objetivo] : []), ...(m.objetivo && m.charlamos.length ? [""] : []), ...m.charlamos.map(bullet)]
      : [];
  const next =
    m.theirs.length || m.ours.length
      ? ["", "🚀 Accionables:", ...section(`De parte de ${m.clientName}:`, m.theirs), ...section("De nuestro lado (Xtract):", m.ours)]
      : [];
  return [
    m.greeting,
    "",
    ...(m.thanks ? [m.thanks] : []),
    ...section("📌 Puntos importantes:", m.puntos.map(bullet)),
    ...talked,
    ...next,
    ...section("✅ Ya avanzamos con:", m.done),
    ...(m.extra.length ? ["", ...m.extra] : []),
    // Dos líneas en blanco = un espacio más antes del cierre y antes de "Saludos" (ver `bodyToHtml`).
    "",
    "",
    m.closing,
    "",
    "",
    "Saludos",
  ].join("\n");
}
