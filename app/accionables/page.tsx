import { cookies } from "next/headers";
import { ActionablesBoard } from "@/components/accionables/ActionablesBoard";
import { DENSITY_COOKIE, isMailItem, VIEW_COOKIE } from "@/components/accionables/format";
import type { FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import { getFollowupDraft } from "@/lib/utils/followup";
import { composerThreads } from "@/lib/utils/followup-thread";
import { listEventsBetween } from "@/lib/integrations/calendar";
import { getClientsFileCached, getSettingsCached } from "@/lib/server/cached-data";
import { computeWeekPlan, hasWorkLeftThisWeek, planWeekBounds } from "@/lib/utils/week-plan";
import { pendingSuggestions } from "@/lib/utils/deadlines";

// Tablero de accionables por plazo: cada pendiente de las cuentas asignadas con su fecha de entrega
// (manual → acordada en la reunión/mail → meta interna de N días hábiles), estimación y prioridad.
// "En riesgo" sale de proyectar lo propio en los huecos libres de Calendar (solo lectura).
export const dynamic = "force-dynamic";

export default async function AccionablesPage() {
  const [{ clients, ownerEmail }, settings, jar] = await Promise.all([getClientsFileCached(), getSettingsCached(), cookies()]);
  const initialView = jar.get(VIEW_COOKIE)?.value === "list" ? "list" : "board";
  const initialDensity = jar.get(DENSITY_COOKIE)?.value === "compact" ? "compact" : "comfy";
  const now = new Date();
  const offset = hasWorkLeftThisWeek(now, settings) ? 0 : 1;
  const { start, end } = planWeekBounds(now, offset);
  const events = await listEventsBetween(start, end).catch(() => null);
  const plan = computeWeekPlan(clients, settings, events, offset, now);

  // Panel de mail de la card (mismo que Seguimiento del Dashboard): el mail único de la cuenta, solo donde hace falta.
  const mailPanels: Record<string, FollowupPanelData> = {};
  for (const item of plan.items) {
    const key = item.clientId;
    if (!isMailItem(item) || mailPanels[key]) continue;
    const c = clients.find((x) => x.id === item.clientId);
    const latest = c && [...c.meetings].sort((x, y) => y.date.localeCompare(x.date))[0];
    if (!c || !latest) continue;
    mailPanels[key] = {
      meetingTitle: latest.title,
      draft: getFollowupDraft(c, latest, ownerEmail ?? null, settings),
      threads: composerThreads(c),
      lastMail: c.activity?.lastMail ?? null,
    };
  }

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold">Accionables</h1>
        <p className="text-sm text-muted-foreground">
          Lo pendiente de tus cuentas asignadas, ordenado por fecha de entrega y agrupado por cuenta.
        </p>
      </div>
      <ActionablesBoard
        items={plan.items}
        weekLabel={plan.weekLabel}
        calendarConnected={plan.source === "calendar"}
        freeHours={plan.totals.freeCoreHours + plan.totals.freeFlexHours}
        initialView={initialView}
        initialDensity={initialDensity}
        mailPanels={mailPanels}
        nowIso={now.toISOString()}
        suggestions={pendingSuggestions(clients, settings, now, ownerEmail ?? null)}
        people={settings.people}
        corrections={settings.corrections}
        workDays={settings.workDays}
        targetDays={settings.targetBusinessDays}
        limitDays={settings.limitBusinessDays}
      />
    </div>
  );
}
