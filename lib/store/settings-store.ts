import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Jornada laboral y supuestos de capacidad. Archivo local `.data/settings.json`.
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
};

const FILE = path.join(process.cwd(), ".data", "settings.json");

export async function getSettings(): Promise<WorkSettings> {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(await readFile(FILE, "utf-8")) as Partial<WorkSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
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
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
