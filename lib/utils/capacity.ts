import type { WorkSettings } from "@/lib/store/settings-store";

// Helpers de jornada y de "accionable propio" ("[Tu nombre] …", sin prefijo, o
// "[El grupo]" si includeGroupTasks). La carga semanal vive en account-load.ts.

const GROUP = /^(el grupo|the group|todos|everyone)$/i;

export const isGroupOwner = (owner: string) => GROUP.test(owner.trim());

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function dailyWorkHours(s: WorkSettings): number {
  return Math.max(0, toMinutes(s.workEnd) - toMinutes(s.workStart) - s.lunchMinutes) / 60;
}

export function isOwnActionable(step: string, s: WorkSettings): boolean {
  const owner = step.match(/^\s*\[([^\]]+)\]/)?.[1];
  if (!owner) return true;
  if (GROUP.test(owner.trim())) return s.includeGroupTasks;
  const o = norm(owner);
  return s.ownerAliases.some((alias) => {
    const a = norm(alias);
    return a && (o === a || o.startsWith(a) || a.startsWith(o));
  });
}
