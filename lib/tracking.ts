import type { TrackingStatus } from "@/types/account";

// Pipeline de tareas del Tablero Seguimiento. El status inicial de cada cuenta lo
// calcula lib/utils/tracking-heuristic.ts (placeholder de Fase 1, sin agente LLM
// todavía); el usuario puede corregirlo a mano por drag-and-drop.
export const TRACKING_COLUMNS: { status: TrackingStatus; label: string }[] = [
  { status: "tasks_generated", label: "Tareas Generadas" },
  { status: "tasks_in_progress", label: "Tareas en Curso" },
  { status: "tasks_priority", label: "Tareas con Prioridad" },
  { status: "tasks_done", label: "Tareas Finalizadas" },
];
