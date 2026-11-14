// Tipo de tarea de un accionable por su verbo inicial (sin IA), para estimar con los tiempos del PM
// (`settings.estimateGuide`): comunicación (mails, seguimiento, agendar), revisar, configurar o desarrollo.

export type TaskKind = "comms" | "review" | "config" | "build";

export interface EstimateGuide {
  /** Mails, seguimiento, pedir/compartir algo, agendar: valor fijo. */
  comms: number;
  /** Revisar, analizar, validar. */
  review: number;
  /** Configurar, parametrizar, ajustar, cargar. */
  config: number;
  /** Pruebas, desarrollo, integración, documentar. */
  build: number;
}

export const DEFAULT_ESTIMATE_GUIDE: EstimateGuide = { comms: 15, review: 20, config: 45, build: 60 };

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  comms: "mails y seguimiento",
  review: "revisar / analizar",
  config: "configurar / ajustar",
  build: "desarrollo / pruebas",
};

const RULES: [TaskKind, RegExp][] = [
  [
    "comms",
    /^(responder|contestar|confirmar|enviar|reenviar|compartir|pedir|solicitar|consultar|reclamar|avisar|informar|recordar|notificar|contactar|escalar|comunicar|agendar|coordinar|programar|convocar|reprogramar|seguir|hacer seguimiento|dar seguimiento|pasar|presentar|pedido|compromiso)\b/i,
  ],
  ["review", /^(revisar|analizar|validar|verificar|controlar|chequear|identificar|investigar|evaluar|relevar|auditar|confirmar si)\b/i],
  [
    "config",
    /^(configurar|parametrizar|ajustar|cargar|actualizar|habilitar|asociar|mapear|limpiar|eliminar|corregir|definir|unificar|filtrar|excluir|asignar|vincular|dar de alta|modificar|reasignar)\b/i,
  ],
  [
    "build",
    /^(probar|realizar pruebas|testear|preparar|desarrollar|implementar|integrar|automatizar|grabar|documentar|armar|agregar|crear|generar|procesar|exportar|importar|migrar|construir|resolver)\b/i,
  ],
];

export function taskKind(title: string, mailKind?: "reply" | "request" | "commitment" | null): TaskKind | null {
  if (mailKind) return "comms";
  const t = title.trim().replace(/^\[[^\]]+\]\s*/, "");
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return null;
}

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/**
 * Minutos según tus tiempos: comunicación = valor fijo; el resto = la estimación de la IA acotada entre 0,75× y
 * 1,5× tu tiempo de referencia (sin IA, tu tiempo de referencia). Sin tipo reconocido: la IA tal cual.
 */
export function guidedMinutes(kind: TaskKind | null, ai: number | undefined, guide: EstimateGuide): { minutes: number; source: "guide" | "ai" } | null {
  if (kind === "comms") return { minutes: guide.comms, source: "guide" };
  if (kind) {
    const base = guide[kind];
    if (!ai) return { minutes: base, source: "guide" };
    const clamped = Math.min(round5(base * 1.5), Math.max(round5(base * 0.75), ai));
    return { minutes: clamped, source: "ai" };
  }
  return ai ? { minutes: ai, source: "ai" } : null;
}

/** "mails y seguimiento 15 min · revisar / analizar 20 min · …" para los prompts. */
export const guideText = (g: EstimateGuide) =>
  (Object.keys(TASK_KIND_LABEL) as TaskKind[]).map((k) => `${TASK_KIND_LABEL[k]} ${g[k]} min`).join(" · ");
