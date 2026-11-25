import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PostMeetingSchema, type PostMeetingOutput } from "@/lib/llm/postmeeting-schema";
import { ACTIONABLE_LINE_RE, mailFromOutput, relativeDay, weeklyClosing, weeklyThanks } from "@/lib/utils/postmeeting-mail";
import { bodyToHtml } from "@/lib/integrations/gmail";
import { splitNotesAndTranscript } from "@/lib/utils/transcript";

const SAMPLE: PostMeetingOutput = {
  dia_reunion: "miércoles",
  intro_mail: "Buen día equipo,\nGracias por el espacio del miércoles. Les dejo un resumen rápido de lo que charlamos y cómo seguimos:",
  cierre_mail: "Si ven algo distinto o quedó algún detalle afuera, me avisan.",
  objetivo: "Revisión técnica de integraciones con Finnegans y validación de pruebas en Xtract.",
  puntos_importantes: ["Revisión técnica de API de Finnegans (endpoints faltantes).", "Mapeo de productos."],
  lo_que_charlamos: ["Se acordó utilizar inicialmente la exportación manual desde Xtract."],
  accionables: [
    {
      titulo: "Revisar endpoints faltantes",
      descripcion: "Detalle largo para la card (no va al mail).",
      resumen_mail: "Analizar en el diccionario de API de Finnegans los puntos de conexión faltantes.",
      responsable: "Facundo Miguel Zingone",
      empresa: "cliente",
      status: "Pendiente",
      fecha: null,
      requiere_revision: false,
      minutos_estimados: 30,
    },
    {
      titulo: "Confirmar aprobación de facturas sin OC",
      descripcion: "Detalle largo para la card (no va al mail).",
      resumen_mail: "Validar con jefatura el esquema para la carga directa de facturas de servicios sin OC",
      responsable: "Facundo Miguel Zingone",
      empresa: "cliente",
      status: "Stand By",
      fecha: null,
      requiere_revision: false,
      minutos_estimados: 30,
    },
  ],
  ya_avanzamos: [
    {
      titulo: "Acceso y validación de credenciales",
      descripcion: "Detalle largo para la card (no va al mail).",
      resumen_mail: "Confirmación de ingreso de Xtract a la cuenta de Finnegans.",
      responsable: "",
      empresa: "ambas",
      fecha: null,
    },
  ],
  revision: [],
};

/** Viñetas de "Accionables" y "Ya avanzamos con" (después de "Lo que charlamos"). */
const actionLines = (body: string) => {
  const lines = body.split("\n");
  return lines.slice(lines.findIndex((l) => l.startsWith("🚀"))).filter((l) => l.startsWith("• "));
};

describe("mail post-reunión", () => {
  it("el JSON de ejemplo respeta el schema", () => {
    expect(PostMeetingSchema.safeParse(SAMPLE).success).toBe(true);
    expect(PostMeetingSchema.safeParse({ ...SAMPLE, accionables: [{ ...SAMPLE.accionables[0], status: "Bloqueado" }] }).success).toBe(false);
  });

  it("cada accionable sale como 'Título: Descripción. (Responsable) - Status: X emoji'", () => {
    const body = mailFromOutput(SAMPLE, "Salvita Alimentos", "Alexis", "11/11");
    const lines = actionLines(body);
    expect(lines).toEqual([
      "• Revisar endpoints faltantes: Analizar en el diccionario de API de Finnegans los puntos de conexión faltantes. (Facundo) - Status: Pendiente ⏳",
      "• Confirmar aprobación de facturas sin OC: Validar con jefatura el esquema para la carga directa de facturas de servicios sin OC. (Facundo) - Status: Stand By ⏳",
      "• Acceso y validación de credenciales: Confirmación de ingreso de Xtract a la cuenta de Finnegans. (Xtract y Salvita Alimentos) - Status: Hecho ✅ (11/11)",
    ]);
    for (const l of lines) expect(l).toMatch(ACTIONABLE_LINE_RE);
  });

  it("el mail usa la versión corta y no el detalle de la card", () => {
    expect(mailFromOutput(SAMPLE, "Salvita Alimentos", "Alexis", "11/11")).not.toContain("Detalle largo");
  });

  it("estructura fija y secciones vacías omitidas", () => {
    const body = mailFromOutput(SAMPLE, "Salvita Alimentos", "Alexis", "11/11");
    const order = ["Buen día equipo,", "Gracias por el espacio del miércoles", "📌 Puntos importantes:", "Lo que charlamos:", "🚀 Accionables:", "De parte de Salvita Alimentos:", "✅ Ya avanzamos con:", "Si ven algo distinto", "Saludos"];
    const idx = order.map((t) => body.indexOf(t));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(body).not.toContain("De nuestro lado (Xtract):");
    // El saludo de la IA no se duplica: lo pone la app.
    expect(body.match(/Buen día/g)).toHaveLength(1);
    expect(body).not.toMatch(/N\/A/);
  });

  it("HTML: títulos y status con color, Stand By y emoji", () => {
    const html = bodyToHtml(mailFromOutput(SAMPLE, "Salvita Alimentos", "Alexis", "11/11"));
    expect(html).toContain("<strong>📌 Puntos importantes:</strong>");
    // Accionables: título grande + lista por lado (título en negrita, responsable y status).
    expect(html).toContain('font-size:18px;line-height:1.3;"><strong>🚀 Accionables</strong>');
    expect(html).not.toContain("<table");
    expect(html).toMatch(/De parte de Salvita Alimentos<\/span>:<\/strong><\/p><ul[^>]*><li[^>]*><strong>[^<]*:<\/strong>/);
    expect(html).toContain("<strong>Revisar endpoints faltantes:</strong>");
    expect(html).toContain('<strong style="color:#5F6368">Stand By</strong> ⏳');
    expect(html).toContain('<strong style="color:#D93025">Pendiente</strong> ⏳');
    expect(html).toMatch(/Ya avanzamos con[\s\S]*<ul/);
    expect(html).toContain('<strong>Status:</strong> <strong style="color:#188038">Hecho</strong> ✅ (11/11)');
    // Un punto editado sin el formato igual entra como viñeta.
    const edited = bodyToHtml("🚀 Accionables:\n\nDe parte de X:\n• algo libre que escribí\n\nSaludos");
    expect(edited).toMatch(/<li[^>]*>algo libre que escribí<\/li><\/ul><p[^>]*>Saludos/);
  });

  it("toma el nombre del saludo de la IA", async () => {
    const { greetingName } = await import("@/lib/utils/postmeeting-mail");
    expect(greetingName("Buen día Denise,\nGracias…")).toBe("Denise");
    expect(greetingName("Buenas tardes equipo,\nGracias…")).toBeNull();
    const { matchesAddressing } = await import("@/lib/utils/postmeeting-mail");
    expect(matchesAddressing("Te dejo un resumen rápido", false)).toBe(false);
    expect(matchesAddressing("Les dejo un resumen rápido", false)).toBe(true);
    expect(matchesAddressing("Les dejo un resumen rápido", true)).toBe(false);
  });

  it("separa minuta y transcripción del Doc de Gemini", () => {
    const doc = "Resumen\nAlgo\n\nTítulo - Transcripción\n00:00:01\nAna: hola";
    expect(splitNotesAndTranscript(doc)).toEqual({ notes: "Resumen\nAlgo", transcript: "Título - Transcripción\n00:00:01\nAna: hola" });
  });
});

// Prueba real contra la API (cuesta ~US$ 0,10): RUN_LLM=1 LLM_DOC=<minuta.txt> pnpm test (export de texto del Doc de Gemini).
describe.runIf(process.env.RUN_LLM === "1" && !!process.env.LLM_DOC)("generador con Claude (Salvita 11/11)", () => {
  it("genera JSON válido y un mail con el formato esperado", async () => {
    const { generatePostMeeting } = await import("@/lib/llm/postmeeting");
    const { notes, transcript } = splitNotesAndTranscript(readFileSync(process.env.LLM_DOC!, "utf8"));
    const salvita = "Salvita Alimentos";
    const out = await generatePostMeeting({
      clientName: salvita,
      ownCompany: "Xtract",
      meetingDate: "miércoles, 11/11/2026",
      meetingTitle: "Etapa 2 Integracion (Salvita Alimentos + Xtract)",
      ownerName: "Alexis Vásquez R",
      participants: [
        { name: "Alexis Vásquez R", email: null, company: "Xtract" },
        { name: "Facundo Miguel Zingone", email: "fzingone@salvitaalimentos.com", company: salvita },
        { name: "Fabiana", email: "fabiana_ale@salvitaalimentos.com", company: salvita },
        { name: "M. Fernández", email: "mfernandez@salvitaalimentos.com", company: salvita },
        { name: "F. Minuzzi", email: "fminuzzi@salvitaalimentos.com", company: salvita },
      ],
      openActionables: [],
      corrections: [{ from: "Finegan", to: "Finnegans" }],
      erp: "Finnegans",
      notes,
      transcript,
    });
    expect(PostMeetingSchema.safeParse(out).success).toBe(true);
    const body = mailFromOutput(out, salvita, "Alexis", "11/11");
    const outDir = process.env.LLM_OUT_DIR;
    if (outDir) {
      writeFileSync(path.join(outDir, "salvita-mail.txt"), body, "utf8");
      writeFileSync(path.join(outDir, "salvita-output.json"), JSON.stringify(out, null, 2), "utf8");
    }
    for (const l of actionLines(body)) expect(l).toMatch(ACTIONABLE_LINE_RE);
    expect(out.accionables.length).toBeGreaterThanOrEqual(5);
  });
});

describe("apertura del mail post-reunión", () => {
  it("el día de la IA pasa a relativo (hoy / ayer / día)", () => {
    const intro = "Gracias por el espacio del martes. Te dejo un resumen de lo que vimos y cómo seguimos:";
    expect(relativeDay(intro, "de hoy")).toBe("Gracias por el espacio de hoy. Te dejo un resumen de lo que vimos y cómo seguimos:");
    expect(relativeDay(intro, "de ayer")).toContain("espacio de ayer.");
    expect(relativeDay("Gracias por la reunión de hoy.", "del martes")).toBe("Gracias por la reunión del martes.");
  });

  it("la apertura con dos oraciones no va como título", () => {
    const html = bodyToHtml("Buenas tardes equipo,\n\nGracias por el espacio de ayer. Te dejo un resumen de lo que vimos y cómo seguimos:");
    expect(html).not.toContain("underline");
    expect(html).toContain('<p style="margin:0 0 12px 0;">Gracias por el espacio de ayer.');
  });
});

describe("apertura semanal", () => {
  it("igual toda la semana (lun–dom), distinta la siguiente, con trato y día", () => {
    const mon = new Date(2026, 10, 23, 9), sun = new Date(2026, 10, 29, 20), next = new Date(2026, 10, 30, 9);
    expect(weeklyThanks(mon, "de ayer", true)).toBe(weeklyThanks(sun, "de ayer", true));
    expect(weeklyThanks(next, "de ayer", true)).not.toBe(weeklyThanks(mon, "de ayer", true));
    expect(weeklyThanks(mon, "de hoy", true)).toMatch(/ de hoy\. Te /);
    expect(weeklyClosing(mon, true)).toBe(weeklyClosing(sun, true));
    expect(weeklyClosing(next, false)).not.toBe(weeklyClosing(mon, false));
    expect(weeklyThanks(mon, "de hoy", false)).toMatch(/ de hoy\. (Les|Para que quede todo registrado, les) /);
  });
});
