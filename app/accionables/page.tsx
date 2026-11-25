import { cookies } from "next/headers";
import { ActionablesBoard } from "@/components/accionables/ActionablesBoard";
import { DENSITY_COOKIE, isMailItem, isReminderItem, ROUND_COOKIE, VIEW_COOKIE } from "@/components/accionables/format";
import type { FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import { getFollowupDraft, getReminderDraft } from "@/lib/utils/followup";
import { composerThreads } from "@/lib/utils/followup-thread";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { getClientsFileCached, getSettingsCached } from "@/lib/server/cached-data";
import { computeWeekPlan, hasWorkLeftThisWeek, planWeekBounds } from "@/lib/utils/week-plan";
import { pendingSuggestions } from "@/lib/utils/deadlines";
import { pendingRewrites } from "@/lib/utils/account-analysis";
import { pendingAudit } from "@/lib/utils/account-audit";
import { getBoardOrder } from "@/lib/store/board-order-store";
import { getTodayAdjust } from "@/lib/store/not-today-store";
import { pendingWeeklyReview } from "@/lib/utils/weekly-learning";

// Tablero de accionables por plazo: cada pendiente de las cuentas asignadas con su fecha de entrega
// (manual → acordada en la reunión/mail → meta interna de N días hábiles), estimación y prioridad.
// "En riesgo" sale de proyectar lo propio en los huecos libres de Calendar (solo lectura).
export const dynamic = "force-dynamic";

export default async function AccionablesPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; cuentas?: string }>;
}) {
  const sp = await searchParams;
  const [{ clients, ownerEmail }, settings, jar, boardOrder, todayAdjust] = await Promise.all([
    getClientsFileCached(),
    getSettingsCached(),
    cookies(),
    getBoardOrder().catch(() => ({})),
    getTodayAdjust().catch(() => ({ skip: new Set<string>(), force: new Set<string>() })),
  ]);
  const initialView = jar.get(VIEW_COOKIE)?.value === "list" ? "list" : "board";
  const initialDensity = jar.get(DENSITY_COOKIE)?.value === "compact" ? "compact" : "comfy";
  const roundCookie = jar.get(ROUND_COOKIE)?.value;
  const initialRound = roundCookie === "backlog" || roundCookie === "all" ? roundCookie : "current";
  const now = new Date();
  const offset = hasWorkLeftThisWeek(now, settings) ? 0 : 1;
  const { start, end } = planWeekBounds(now, offset);
  // Una semana más de eventos: solo para la próxima reunión de cada cuenta (grupo "Reunión próxima").
  const events = await listEventsBetween(start, new Date(end.getTime() + 7 * 86_400_000)).catch(() => null);
  const plan = computeWeekPlan(clients, settings, events, offset, now, todayAdjust);

  // Panel de mail de la card (mismo que Seguimiento del Dashboard): el mail único de la cuenta, solo donde hace falta.
  // Los de Seguimiento (me deben) suman "Pedir status": recordatorio corto de ese punto solo (`itemReminders`).
  const mailPanels: Record<string, FollowupPanelData> = {};
  const itemReminders: Record<string, FollowupPanelData["draft"]> = {};
  for (const item of plan.items) {
    const key = item.clientId;
    if (!isMailItem(item)) continue;
    const c = clients.find((x) => x.id === item.clientId);
    const latest = c && [...c.meetings].sort((x, y) => y.date.localeCompare(x.date))[0];
    if (!c || !latest) continue;
    if (isReminderItem(item)) itemReminders[item.id] = getReminderDraft(c, latest, ownerEmail ?? null, settings, item.id);
    if (mailPanels[key]) continue;
    mailPanels[key] = {
      meetingTitle: latest.title,
      draft: getFollowupDraft(c, latest, ownerEmail ?? null, settings),
      reminder: getReminderDraft(c, latest, ownerEmail ?? null, settings),
      threads: composerThreads(c),
      lastMail: c.activity?.lastMail ?? null,
    };
  }

  return (
    <div className="px-4 py-4 sm:px-6">
      <ActionablesBoard
        items={plan.items}
        weekLabel={plan.weekLabel}
        calendarConnected={plan.source === "calendar"}
        freeHours={plan.totals.freeCoreHours + plan.totals.freeFlexHours}
        initialView={initialView}
        initialDensity={initialDensity}
        initialRound={initialRound}
        mailPanels={mailPanels}
        itemReminders={itemReminders}
        nowIso={now.toISOString()}
        suggestions={pendingSuggestions(clients, settings, now, ownerEmail ?? null)}
        rewrites={pendingRewrites(clients)}
        audit={pendingAudit(clients, settings, now)}
        weeklyReview={pendingWeeklyReview(clients, now)}
        people={settings.people}
        corrections={settings.corrections}
        workDays={settings.workDays}
        targetDays={settings.targetBusinessDays}
        limitDays={settings.limitBusinessDays}
        boardOrder={boardOrder}
        focusId={sp.item ?? null}
        initialAccounts={(sp.cuentas ?? "").split(",").filter(Boolean)}
      />
    </div>
  );
}
