import { z } from "zod";

// Salida fija del análisis semanal de una cuenta (Claude). Se guarda en `client.analysis`, alimenta el resumen
// del lunes (`lib/utils/weekly-digest.ts`) y los accionables nuevos (ref = null) pasan al tablero como propios
// con origen "IA" (`setAccountAnalysis`). Los existentes se nombran por su ref ("A3") y nunca se modifican solos.

export const ACCOUNT_STATES = [
  "avanzando",
  "esperando_cliente",
  "esperando_xtract",
  "bloqueada",
  "en_riesgo",
  "sin_actividad",
] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const LEVELS = ["alta", "media", "baja"] as const;
export type Level = (typeof LEVELS)[number];

const Accionable = z.object({
  ref: z
    .string()
    .nullable()
    .describe('Ref del accionable existente ("A3") si es uno de la lista <accionables_abiertos>; null si es NUEVO'),
  titulo: z.string().describe("2 a 6 palabras, en infinitivo"),
  descripcion: z
    .string()
    .describe("Oración autocontenida: qué hacer, sobre qué y para qué, con los datos concretos (va a la card)"),
  lado: z.enum(["debo", "me_deben"]).describe("debo = lo hace Xtract (yo o mi equipo); me_deben = lo hace el cliente o un tercero"),
  responsable: z.string().describe('Nombre completo de quien lo hace; "" si no está claro'),
  prioridad: z.enum(LEVELS),
  fecha: z.string().nullable().describe("dd/mm SOLO si se acordó una fecha concreta en la reunión o en un mail; si no, null"),
  evidencia: z
    .string()
    .describe('De dónde sale: "Reunión 11/11" o "Mail de Facundo 12/11: «Asunto»". Breve.'),
  minutos_estimados: z
    .number()
    .int()
    .describe("Minutos de trabajo efectivo de Xtract para completarlo (lado debo); 0 si es me_deben. Ver la guía de estimación"),
});

const Conversacion = z.object({
  asunto: z.string().describe("Asunto del hilo, sin Re:/Fwd:"),
  tema: z.string().describe("De qué trata y en qué quedó, en una oración"),
  estado: z.enum(["espera_mi_respuesta", "espera_cliente", "en_curso", "resuelto", "informativo"]),
  ultimo_de: z.enum(["cliente", "yo", "equipo"]),
  fecha: z.string().describe("dd/mm del último mensaje"),
});

export const AccountAnalysisSchema = z.object({
  estado: z.enum(ACCOUNT_STATES),
  resumen: z.string().describe("2 a 4 oraciones: dónde está la cuenta hoy y qué falta para avanzar"),
  ultima_interaccion: z.object({
    tipo: z.enum(["reunion", "mail_cliente", "mail_mio", "mail_equipo"]),
    fecha: z.string().describe("dd/mm"),
    resumen: z.string().describe("Qué se dijo o pidió, en una oración"),
  }),
  prioridad: z.object({
    nivel: z.enum(LEVELS),
    engagement: z.enum(LEVELS).describe("Qué tan activo y comprometido está el cliente"),
    complejidad: z.enum(LEVELS).describe("Dificultad técnica / política de la cuenta"),
    motivo: z.string().describe("Por qué esa prioridad, en una oración"),
  }),
  conversaciones: z.array(Conversacion).describe("Una por hilo de mail relevante del período, más reciente primero"),
  accionables_semana: z
    .array(Accionable)
    .describe("Plan de la semana: abiertos que siguen vigentes (con ref) + los que faltan en el tablero (ref null)"),
  posibles_resueltos: z
    .array(z.object({ ref: z.string(), evidencia: z.string() }))
    .describe("Abiertos que según los mails o la reunión ya parecen hechos (el PM los verifica y tilda)"),
  reescrituras: z
    .array(
      z.object({
        ref: z.string().describe('Ref de un abierto marcado "reescribible"'),
        titulo: z.string().describe("2 a 6 palabras, en infinitivo"),
        descripcion: z.string().describe("Oración autocontenida con los datos concretos, como en accionables nuevos"),
        responsable: z.string().describe('Nombre completo de quien lo hace; "" si no está claro'),
        motivo: z.string().describe("Por qué se reescribe (vago, incompleto, mal transcripto, responsable faltante)"),
      }),
    )
    .describe("Mejor redacción para abiertos reescribibles cuyo texto actual es pobre; el PM la acepta o no"),
  riesgos: z.array(z.string()).describe("Riesgos, bloqueos o detalles que se pueden escapar; vacío si no hay"),
  proximo_mail: z
    .string()
    .describe("Qué debería decir mi próximo mail de seguimiento, a quién y en qué hilo; 2 a 3 oraciones"),
  revision: z.array(z.string()).describe("Dudas para el PM (datos contradictorios, responsables no claros)"),
});

export type AccountAnalysisOutput = z.infer<typeof AccountAnalysisSchema>;
export type AnalysisActionable = AccountAnalysisOutput["accionables_semana"][number];
