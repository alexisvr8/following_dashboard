// Template único del mail post-reunión (con o sin IA). Estructura fija, en este orden:
// saludo → agradecimiento → Puntos importantes → Lo que charlamos (objetivo + bullets) → Accionables de {cliente}
// → Accionables de Xtract → Ya avanzamos con → cierre → Saludos. Las secciones vacías se omiten.
// Viñetas "• " (las convierte `bodyToHtml`/`bodyToPlain`); status con la lógica de siempre + emoji.

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

/** "• Título: Descripción. (Responsable) - Status: X emoji" */
export function actionableLine(text: string, owner: string, status: MailStatus, doneDay?: string | null): string {
  return `• ${withPeriod(text)}${owner ? ` (${owner})` : ""}${statusSuffix(status, doneDay)}`;
}

/** Formato de una línea de accionable del mail (lo valida el test). */
export const ACTIONABLE_LINE_RE =
  /^• [^:]{2,80}: .+\. \([^()]+\) - Status: (Pendiente ⏳|En curso ⏳|Stand By ⏳|Hecho ✅( \(\d{2}\/\d{2}\))?)$/u;

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
    thanks: `Gracias por el espacio del ${out.dia_reunion} y por su tiempo y disposición. Les comparto un resumen y los próximos pasos.`,
    puntos: out.puntos_importantes,
    objetivo: out.objetivo,
    charlamos: out.lo_que_charlamos,
    clientName: client,
    theirs: out.accionables.filter((a) => a.empresa !== "xtract").map(line),
    ours: out.accionables.filter((a) => a.empresa === "xtract").map(line),
    done: out.ya_avanzamos.map((a) => actionableLine(`${a.titulo}: ${a.resumen_mail}`, owner(a), "Hecho", a.fecha ?? meetingDay)),
    extra: [],
    closing: "Quedo a disposición por si tienen alguna consulta o si algo no quedó reflejado.",
  });
}

export function renderPostMeetingMail(m: PostMeetingMail): string {
  const section = (title: string, rows: string[]) => (rows.length ? ["", title, ...rows] : []);
  const talked =
    m.objetivo || m.charlamos.length
      ? ["", "Lo que charlamos:", ...(m.objetivo ? [m.objetivo] : []), ...(m.objetivo && m.charlamos.length ? [""] : []), ...m.charlamos.map(bullet)]
      : [];
  return [
    m.greeting,
    "",
    m.thanks,
    ...section("Puntos importantes:", m.puntos.map(bullet)),
    ...talked,
    ...section(`Accionables de ${m.clientName}:`, m.theirs),
    ...section("Accionables de Xtract:", m.ours),
    ...section("Ya avanzamos con:", m.done),
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
