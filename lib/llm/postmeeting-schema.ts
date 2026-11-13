import { z } from "zod";

// Salida fija del generador post-reunión (Claude). El mail se arma desde acá con el template
// (`lib/utils/postmeeting-mail.ts`) y los mismos accionables pasan a ser los `nextSteps` de la reunión.

/** Status que puede proponer el modelo para un accionable abierto (Hecho lo pone la app al tildar). */
export const AI_STATUSES = ["Pendiente", "En curso", "Stand By"] as const;
export type AIStatus = (typeof AI_STATUSES)[number];

export const AI_SIDES = ["cliente", "xtract", "ambas"] as const;
export type AISide = (typeof AI_SIDES)[number];

const Accionable = z.object({
  titulo: z.string().describe("2 a 6 palabras, en infinitivo"),
  descripcion: z.string().describe("Oración completa y autocontenida con todos los datos concretos (va a la card)"),
  resumen_mail: z.string().describe("Versión corta para el mail: qué y para qué, máx. ~20 palabras"),
  responsable: z
    .string()
    .describe('Nombre completo tal como aparece en la reunión; varios separados por ", "; "" si no se dijo'),
  empresa: z.enum(AI_SIDES),
  status: z.enum(AI_STATUSES),
  fecha: z.string().nullable().describe("dd/mm solo si se acordó una fecha; si no, null"),
  requiere_revision: z.boolean(),
});

const Avance = z.object({
  titulo: z.string(),
  descripcion: z.string(),
  resumen_mail: z.string(),
  responsable: z.string(),
  empresa: z.enum(AI_SIDES),
  fecha: z.string().nullable().describe("dd/mm en que se completó; null = el día de la reunión"),
});

export const PostMeetingSchema = z.object({
  dia_reunion: z.string().describe('Día de la semana de la reunión en minúsculas ("miércoles")'),
  objetivo: z.string().describe("Una línea con el objetivo de la reunión"),
  puntos_importantes: z.array(z.string()),
  lo_que_charlamos: z.array(z.string()),
  accionables: z.array(Accionable),
  ya_avanzamos: z.array(Avance),
  revision: z.array(z.string()).describe("Dudas para que revise el usuario; nunca van en el mail"),
});

export type PostMeetingOutput = z.infer<typeof PostMeetingSchema>;
export type PostMeetingActionable = PostMeetingOutput["accionables"][number];
export type PostMeetingDone = PostMeetingOutput["ya_avanzamos"][number];
