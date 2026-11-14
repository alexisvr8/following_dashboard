import { getState, setState } from "@/lib/store/backend";

export type PersonRole = "me" | "team" | "client" | "partner";
export interface Correction {
  from: string;
  to: string;
}

/** Clave de `settings.people`: nombre sin acentos, minúsculas y espacios simples. */
export const personKey = (name: string) =>
  name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

// Jornada laboral y supuestos de capacidad. `app_state.settings` (o `.data/settings.json`).
export interface WorkSettings {
  /** "HH:MM" ventana extendida (lo más temprano que arrancás / lo más tarde que terminás). */
  workStart: string;
  workEnd: string;
  /** "HH:MM" horario normal (núcleo). Fuera de esto = horario flexible. */
  coreStart: string;
  coreEnd: string;
  /** Almuerzo por defecto: solo se usa los días sin evento "Almuerzo" en Calendar. */
  lunchStart: string;
  lunchMinutes: number;
  /** 1 = lunes … 5 = viernes (0 = domingo). */
  workDays: number[];
  /** Horas estimadas por accionable propio (las minutas no traen estimación). */
  hoursPerActionable: number;
  /** Nombres con los que Gemini te asigna tareas: "[Alexis Vásquez R] …". */
  ownerAliases: string[];
  /** Contar tareas de "[El grupo]" / "[The group]" como propias. */
  includeGroupTasks: boolean;
  /** Días hábiles sin avance/actualización con el cliente antes de alertar (default 2). */
  staleBusinessDays: number;
  /** Cuentas "Más atención": meta interna (días hábiles) y días sin novedades para alertar. Default 1 y 1. */
  attentionTargetDays?: number;
  attentionStaleDays?: number;
  /** Meta interna de un accionable sin fecha dicha en la reunión: N días hábiles desde la reunión/mail (default 3). */
  targetBusinessDays: number;
  /** Desde ahí pasa a "Vencido" (default 4). */
  limitBusinessDays: number;
  /** Correcciones aprendidas ("Extract" → "Xtract"): se aplican a minutas, transcripciones y accionables. */
  corrections: Correction[];
  /** Crear solo el borrador de minuta en Gmail apenas llega la minuta de Gemini (nunca se envía). */
  autoMeetingDrafts: boolean;
  /** Rol aprendido por persona (clave `personKey`): decide debo / me deben y de qué lado va en los mails. */
  people: Record<string, PersonRole>;
}

export const DEFAULT_SETTINGS: WorkSettings = {
  workStart: "09:00",
  workEnd: "18:00",
  coreStart: "10:00",
  coreEnd: "17:30",
  lunchStart: "14:00",
  lunchMinutes: 60,
  workDays: [1, 2, 3, 4, 5],
  hoursPerActionable: 0.5,
  ownerAliases: ["Alexis Vásquez R"],
  includeGroupTasks: true,
  staleBusinessDays: 2,
  targetBusinessDays: 3,
  limitBusinessDays: 4,
  corrections: [],
  people: {},
  autoMeetingDrafts: true,
};

export async function getSettings(): Promise<WorkSettings> {
  return { ...DEFAULT_SETTINGS, ...((await getState<Partial<WorkSettings>>("settings")) ?? {}) };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateSettings(patch: Partial<WorkSettings>): Promise<WorkSettings> {
  const next = await getSettings();
  if (typeof patch.workStart === "string" && HHMM.test(patch.workStart)) next.workStart = patch.workStart;
  if (typeof patch.workEnd === "string" && HHMM.test(patch.workEnd)) next.workEnd = patch.workEnd;
  if (typeof patch.coreStart === "string" && HHMM.test(patch.coreStart)) next.coreStart = patch.coreStart;
  if (typeof patch.coreEnd === "string" && HHMM.test(patch.coreEnd)) next.coreEnd = patch.coreEnd;
  if (typeof patch.lunchStart === "string" && HHMM.test(patch.lunchStart)) next.lunchStart = patch.lunchStart;
  if (typeof patch.lunchMinutes === "number" && patch.lunchMinutes >= 0 && patch.lunchMinutes <= 240) {
    next.lunchMinutes = Math.round(patch.lunchMinutes);
  }
  if (Array.isArray(patch.workDays)) {
    next.workDays = [...new Set(patch.workDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  }
  if (typeof patch.hoursPerActionable === "number" && patch.hoursPerActionable >= 0 && patch.hoursPerActionable <= 40) {
    next.hoursPerActionable = patch.hoursPerActionable;
  }
  if (Array.isArray(patch.ownerAliases)) {
    next.ownerAliases = patch.ownerAliases.map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
  }
  if (typeof patch.includeGroupTasks === "boolean") next.includeGroupTasks = patch.includeGroupTasks;
  if (typeof patch.staleBusinessDays === "number" && patch.staleBusinessDays >= 1 && patch.staleBusinessDays <= 15) {
    next.staleBusinessDays = Math.round(patch.staleBusinessDays);
  }
  if (typeof patch.targetBusinessDays === "number" && patch.targetBusinessDays >= 1 && patch.targetBusinessDays <= 10) {
    next.targetBusinessDays = Math.round(patch.targetBusinessDays);
  }
  if (typeof patch.limitBusinessDays === "number" && patch.limitBusinessDays >= 1 && patch.limitBusinessDays <= 15) {
    next.limitBusinessDays = Math.round(patch.limitBusinessDays);
  }
  if (next.limitBusinessDays < next.targetBusinessDays) next.limitBusinessDays = next.targetBusinessDays;
  if (Array.isArray(patch.corrections)) {
    const seen = new Set<string>();
    next.corrections = patch.corrections
      .filter((c) => c && typeof c.from === "string" && typeof c.to === "string" && c.from.trim() && c.from.trim() !== c.to.trim())
      .map((c) => ({ from: c.from.trim().slice(0, 80), to: c.to.trim().slice(0, 80) }))
      .filter((c) => !seen.has(c.from.toLowerCase()) && seen.add(c.from.toLowerCase()))
      .slice(0, 300);
  }
  if (typeof patch.autoMeetingDrafts === "boolean") next.autoMeetingDrafts = patch.autoMeetingDrafts;
  if (patch.people && typeof patch.people === "object") {
    const ROLES: PersonRole[] = ["me", "team", "client", "partner"];
    next.people = Object.fromEntries(
      Object.entries(patch.people)
        .filter(([k, v]) => k.trim() && ROLES.includes(v))
        .map(([k, v]) => [personKey(k), v])
        .slice(0, 500),
    );
  }
  await setState("settings", next);
  return next;
}
