/**
 * Ronda de un accionable (sin dependencias: lo usa el tablero). Por semanas de calendario: `current` = "Esta semana"
 * (salió esta semana o la anterior, o tiene fecha acordada en esta semana); `backlog` = "Semana pasada" (lo de antes
 * que sigue abierto). Ver `roundOf` en deadlines.ts.
 */
export type Round = "current" | "backlog";
