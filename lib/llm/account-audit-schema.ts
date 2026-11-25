import { z } from "zod";

// Salida fija de la AUDITORÍA única de una cuenta (Opus, `scripts/audit-accounts.ts`): cruza las últimas reuniones
// (minuta + transcripción), todos los mails del período (incluidos partners) y el tablero. Nada se aplica solo: cada
// propuesta pasa por el modal "Auditoría" de /accionables (`client.audit`, `pendingAudit`).

const Confianza = z.enum(["alta", "media", "baja"]);

const Veredicto = z.object({
  ref: z.string().describe('Ref del accionable del tablero ("A3"). Una entrada por CADA ref de <tablero>'),
  veredicto: z
    .enum(["vigente", "hecho", "duplicado", "no_corresponde", "dudoso"])
    .describe(
      "vigente = sigue abierto; hecho = hay evidencia de que se completó; duplicado = es lo mismo que otro ref; no_corresponde = quedó obsoleto o se descartó; dudoso = no alcanza la evidencia (va con pregunta)",
    ),
  duplicado_de: z.string().nullable().describe('Si es duplicado: el ref que se conserva ("A1"); si no, null'),
  fecha_hecho: z.string().nullable().describe('Si es hecho: "dd/mm" de la evidencia (cuándo se completó); si no, null'),
  lado: z
    .enum(["debo", "me_deben"])
    .describe("Lado correcto: debo = lo ejecuta Xtract (el PM o su equipo); me_deben = el cliente, un partner o un dev externo"),
  responsable: z.string().describe('Nombre completo de quien lo ejecuta según los datos; "" si no está claro'),
  reescritura: z
    .object({
      titulo: z.string().describe("2 a 6 palabras, en infinitivo"),
      descripcion: z.string().describe("Oración autocontenida con los datos concretos"),
    })
    .nullable()
    .describe("Solo si el texto actual es vago, incompleto, mal transcripto o quedó desactualizado; si es claro, null"),
  fecha_acordada: z
    .string()
    .nullable()
    .describe('"dd/mm" SOLO si en una reunión o mail se acordó una fecha para ESTE punto y difiere de la del tablero; si no, null'),
  confianza: Confianza,
  evidencia: z
    .string()
    .describe('Cita corta y fuente con fecha: «…» (Mail de Facundo 12/11 · "Asunto") o «…» (Reunión 11/11, transcripción). Obligatoria salvo en vigente sin cambios'),
  motivo: z.string().describe("Por qué el veredicto y los cambios, en una oración"),
});

const Faltante = z.object({
  titulo: z.string().describe("2 a 6 palabras, en infinitivo"),
  descripcion: z.string().describe("Oración autocontenida con los datos concretos (proveedor, campo, entorno, persona)"),
  lado: z.enum(["debo", "me_deben"]),
  responsable: z.string().describe('Nombre completo; "" si no está claro'),
  fecha: z.string().nullable().describe('"dd/mm" solo si se acordó; si no, null'),
  confianza: Confianza,
  evidencia: z.string().describe("Cita corta y fuente con fecha"),
});

export const AccountAuditSchema = z.object({
  cuenta: z.object({
    resumen: z.string().describe("3 a 5 oraciones: en qué está el proyecto hoy, qué se avanzó y qué falta para el próximo hito"),
    etapa: z.string().describe('Etapa y paso según los datos ("Etapa 2 · pruebas en homologación"); "" si no está claro'),
    erp: z.object({
      valor: z.string().nullable().describe("ERP o sistema del cliente según reuniones/mails; null si no se menciona"),
      evidencia: z.string(),
    }),
    desarrollo: z.object({
      quien: z
        .enum(["pm", "equipo_xtract", "cliente", "partner", "mixto", "no_claro"])
        .describe("Quién desarrolla la integración: pm = el PM mismo; equipo_xtract = otro dev de Xtract al que el PM guía"),
      detalle: z.string().describe("Quién concretamente (nombres, empresa) y qué parte hace cada uno"),
      confianza: Confianza,
      evidencia: z.string(),
    }),
    rol_pm: z
      .enum(["accionar", "seguimiento", "mixto", "no_claro"])
      .describe("Qué le toca al PM en la cuenta: accionar = ejecuta él; seguimiento = empuja a otros (dev, partner, cliente)"),
    proximo_paso: z.string().describe("El próximo paso concreto de la cuenta y de quién depende"),
  }),
  contactos: z
    .array(
      z.object({
        nombre: z.string(),
        email: z.string().describe('"" si no aparece'),
        empresa: z.string(),
        rol: z.enum(["cliente", "partner", "dev_externo", "xtract", "otro"]),
        nota: z.string().describe("Qué hace en el proyecto, en pocas palabras"),
      }),
    )
    .describe("Personas relevantes para la trazabilidad, sobre todo partners, devs externos y quién decide del cliente"),
  accionables: z.array(Veredicto).describe("Un veredicto por CADA ref de <tablero>, en el mismo orden"),
  faltantes: z
    .array(Faltante)
    .describe("Compromisos o pedidos concretos y todavía abiertos que NO están en el tablero ni en <cerrados>"),
  preguntas: z
    .array(
      z.object({
        tipo: z.enum(["accionable", "cuenta", "mail", "contacto", "otro"]),
        ref: z.string().nullable().describe("Ref del tablero si la pregunta es de un accionable; si no, null"),
        pregunta: z.string().describe("Pregunta concreta para el PM, respondible en una línea"),
        contexto: z.string().describe("Qué viste que genera la duda (con fuente y fecha)"),
      }),
    )
    .describe("Todo lo que no se puede afirmar con los datos: el PM lo valida. Mejor preguntar que suponer"),
});

export type AccountAuditOutput = z.infer<typeof AccountAuditSchema>;
export type AuditVerdict = AccountAuditOutput["accionables"][number];
export type AuditMissing = AccountAuditOutput["faltantes"][number];
