import type { TrackingStatus } from "@/types/account";

// Columnas del Tablero Seguimiento, en el orden en que conviene atacarlas. Cada card se ubica sola
// (lib/utils/board-status.ts) y se puede mover a mano por drag-and-drop.
export const TRACKING_COLUMNS: { status: TrackingStatus; label: string; hint: string }[] = [
  { status: "tasks_priority", label: "Prioridad", hint: "Sin interacción o el cliente espera respuesta: atacar primero" },
  { status: "tasks_generated", label: "Generadas", hint: "Reuniones y mails nuevos, sin empezar" },
  { status: "tasks_in_progress", label: "En curso", hint: "Con al menos un punto marcado" },
  { status: "tasks_done", label: "Finalizadas", hint: "Cerradas esta semana; las anteriores pasan al archivo" },
];
