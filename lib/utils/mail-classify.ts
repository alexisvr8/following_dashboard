// Clasificación por reglas (sin LLM) de mails de clientes: descarta respuestas/invitaciones de
// Calendar, auto-respuestas y minutas; recorta citas; relaciona el mail con accionables.

const CALENDAR_SUBJECT =
  /^(accepted|aceptad[oa]|declined|rechazad[oa]|tentative(ly accepted)?|provisional|aceptad[oa] provisionalmente|invitation|invitaci[oó]n|updated invitation|invitaci[oó]n actualizada|canceled( event)?|cancelled( event)?|evento cancelado|cancelad[oa]|new event|nuevo evento|proposed new time|nueva hora propuesta|nuevo horario propuesto|invitaci[oó]n a un evento)\s*(\(.*?\))?\s*:/i;
const AUTO_SUBJECT = /^(respuesta autom[aá]tica|automatic reply|auto(matic)?[- ]?reply|out of office|fuera de (la )?oficina|ausente)\b/i;
// Reportes automáticos con fecha/hora al final: "Reporte de Gastos (X) 30/10/2026, 16:06:19".
const REPORT_SUBJECT = /\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(:\d{2})?\s*$/;
const MINUTES_SUBJECT = /(notes by gemini|notas de gemini|”? de gemini$|notas de la reuni[oó]n|meeting notes|minuta)/i;

export type MailKind = "message" | "invitation" | "autoReply" | "minutes";

export function classifyMail(input: {
  subject: string;
  from: string;
  headers: Record<string, string>;
  hasCalendarPart: boolean;
}): MailKind {
  const from = input.from.toLowerCase();
  const h = input.headers;
  if (/gemini-notes@google\.com/.test(from) || MINUTES_SUBJECT.test(input.subject)) return "minutes";
  if (
    input.hasCalendarPart ||
    /calendar-notification@google\.com/.test(from) ||
    CALENDAR_SUBJECT.test(input.subject.trim())
  ) {
    return "invitation";
  }
  const auto = (h["auto-submitted"] ?? "").toLowerCase();
  if (
    (auto && auto !== "no") ||
    h["x-autoreply"] ||
    h["x-autorespond"] ||
    /^(auto_reply|bulk|junk)$/i.test(h["precedence"] ?? "") ||
    AUTO_SUBJECT.test(input.subject.trim()) ||
    REPORT_SUBJECT.test(input.subject.trim())
  ) {
    return "autoReply";
  }
  return "message";
}

/** Corta el texto citado de respuestas ("El ... escribió:", "On ... wrote:", ">", "From:"). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (
      /^(el|on)\s.+(escribi[oó]|wrote)\s*:?$/i.test(l) ||
      /^-{2,}\s*(original message|mensaje original|forwarded message|mensaje reenviado)/i.test(l) ||
      /^(de|from)\s*:\s.+@/i.test(l) ||
      /^_{5,}$/.test(l)
    ) {
      break;
    }
    if (l.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const STOPWORDS = new Set(
  (
    "para como esta este esto estos estas sobre entre desde hasta donde cuando porque pero tambien " +
    "segun cada todo todos todas otra otro otros otras ellos ellas nosotros usted ustedes nuestro nuestra " +
    "hacer realizar enviar revisar ver tener puede pueden debe deben sera seran fue son hay muy mas menos " +
    "the and for with that this from will have your their about into reunion equipo grupo cliente " +
    "saludos gracias hola buenas buenos dias tardes quedo atento atenta favor"
  ).split(" "),
);

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function keywords(text: string): Set<string> {
  return new Set(
    norm(text)
      .replace(/^\s*\[[^\]]*\]/, "") // "[Owner] ..." de Gemini
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      // stem pobre: plural/género
      .map((w) => w.replace(/(es|s|a|o)$/, "")),
  );
}

/**
 * Índices de accionables que el mail parece tratar: ≥2 palabras clave compartidas y ≥30% de
 * las palabras clave del accionable presentes en el mail (asunto + cuerpo propio).
 */
export function relatedActionables(mailText: string, steps: string[]): number[] {
  const mail = keywords(mailText);
  const out: number[] = [];
  steps.forEach((step, i) => {
    const k = keywords(step);
    if (!k.size) return;
    let hits = 0;
    for (const w of k) if (mail.has(w)) hits++;
    if (hits >= 2 && hits / k.size >= 0.3) out.push(i);
  });
  return out;
}

const REQUEST =
  /\?|\b(podr[ií]as?|podr[ií]an|pueden|puedes|podemos|necesit\w*|por favor|favor de|quedamos? a la espera|aguardamos|solicit\w*|confirm\w*|nos (env[ií]en|pasen|compartan|indiquen)|me (env[ií]en|pasen|compartan|indiquen)|ser[ií]a posible|ayud\w*|urgente|pendiente)\b/i;
const NOISE = /^(saludos|gracias|muchas gracias|hola|buen(os|as)? (d[ií]as|tardes|noches)|quedo atent|atte|cordialmente|enviado desde|get outlook|this email|este correo|confidencial|aviso legal|antes de imprimir|el presente (correo|mensaje)|este e-?mail|piense en el medio ambiente|la informaci[oó]n contenida|this message|the information|privileged|si (usted )?no es el destinatario|if you are not the intended)/i;

// "Alexis, ¿cómo estás?": saludo con signo de pregunta, no una consulta.
const GREETING_QUESTION = /^(\p{L}+\s*,\s*)?¿?\s*c[oó]mo (est[aá]s|est[aá]n|and[aá]s|and[aá]n|te va|les va|va)\s*\??\.?$/iu;

/** Oraciones propias del mail: sin firma, sin URLs, sin saludos ni avisos legales. */
function ownSentences(text: string): string[] {
  const body = text.replace(/\r/g, "");
  // Corta la firma ("--") y une líneas cortadas por el ancho fijo de texto plano.
  const own = body.split(/\n--\s*\n/)[0];
  return own
    .split(/\n\s*\n/)
    .flatMap((para) =>
      para
        .split("\n")
        .reduce<string[]>((acc, line) => {
          const l = line.trim();
          if (/^[-*•]|^\d+[.)]\s/.test(l) || !acc.length) acc.push(l);
          else acc[acc.length - 1] += ` ${l}`;
          return acc;
        }, [])
        .flatMap((l) => l.split(/(?<=[.?!])\s+/)),
    )
    .map((s) =>
      s
        .replace(/<?(https?:\/\/|mailto:)\S+>?/g, "") // URLs (el "?" de la query no es pregunta)
        .replace(/^[-*•\d.)\s]+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s.length >= 15 && s.length <= 280 && !NOISE.test(s) && !GREETING_QUESTION.test(s));
}

/** Pedidos/preguntas del cliente (oraciones con "?" o verbos de pedido), máx. 5. */
export function extractRequests(text: string): string[] {
  return [...new Set(ownSentences(text).filter((s) => REQUEST.test(s)))].slice(0, 5);
}

const word = (alternatives: string) => new RegExp(`(?<!\\p{L})(${alternatives})(?!\\p{L})`, "iu");
// Lo dicho en futuro siempre es compromiso.
const COMMITMENT_FUTURE = word(
  "voy a|vamos a|me encargo|nos encargamos|me ocupo|nos ocupamos|quedo a cargo|quedamos a cargo|" +
    "(enviar|revisar|avanzar|coordinar|confirmar|compartir|preparar|validar|actualizar|ajustar|cargar|contactar)(é|e|emos)",
);
// En presente solo si dice para cuándo. "Les comparto" y "les escribo" quedan fuera: es lo que hace ese mismo mail.
const COMMITMENT_PRESENT = word(
  "(te|les|le) (env[ií]o|paso|mando|confirmo|aviso|contacto|respondo|actualizo)|lo (reviso|revisamos|veo|vemos|preparo|preparamos)",
);
const COMMITMENT_WHEN = word(
  "mañana|hoy|lunes|martes|mi[eé]rcoles|jueves|viernes|luego|despu[eé]s|m[aá]s tarde|en breve|apenas|cuando|esta semana|pr[oó]xima semana|semana que viene",
);
// "ya" = hecho; "Si deseas…, te confirmo" = condicional, no una promesa.
const NOT_COMMITMENT = word("adjunt\\p{L}*|(voy|vamos) a (estar|quedar)|ya|^si");

/** Lo que prometo en un mail mío ("les envío X el viernes", "voy a revisar Y"), máx. 5. */
export function extractCommitments(text: string): string[] {
  const found = ownSentences(text).filter(
    (s) =>
      !s.includes("?") &&
      !NOT_COMMITMENT.test(s) &&
      (COMMITMENT_FUTURE.test(s) || (COMMITMENT_PRESENT.test(s) && COMMITMENT_WHEN.test(s))),
  );
  return [...new Set(found)].slice(0, 5);
}

/** Similitud por palabras clave (compartidas / min(tamaños)) entre dos accionables. */
export function keywordSimilarity(a: string, b: string): number {
  const ka = keywords(a);
  const kb = keywords(b);
  if (!ka.size || !kb.size) return 0;
  let shared = 0;
  for (const w of ka) if (kb.has(w)) shared++;
  return shared / Math.min(ka.size, kb.size);
}
