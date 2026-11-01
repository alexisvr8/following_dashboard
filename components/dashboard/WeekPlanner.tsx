"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkSettingsDialog } from "@/components/dashboard/WorkSettingsDialog";
import { cn } from "@/lib/utils";
import type { BlockKind, PlanBlock, PlanDay, WeekPlan } from "@/lib/utils/week-plan";
import type { WorkSettings } from "@/lib/store/settings-store";

const fmt = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
const fmtMin = (m: number) => (m < 60 ? `${m}m` : fmt(Math.round((m / 60) * 10) / 10));

const BLOCK_CLASS: Record<BlockKind, string> = {
  client: "bg-series-1",
  other: "bg-foreground/35",
  task: "bg-series-2",
  lunch: "bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_1.5px,transparent_1.5px_6px)] opacity-60",
};

const KIND_LABEL: Record<BlockKind, string> = {
  client: "Reunión con cliente",
  other: "Otra reunión",
  task: "Accionables (proyectado)",
  lunch: "Almuerzo",
};

// Planificador semanal por día: reuniones de Calendar + almuerzo real, huecos libres y
// accionables proyectados en esos huecos. Meta: cerrar los pendientes antes del viernes.
export function WeekPlanner({ plan, settings }: { plan: WeekPlan; settings: WorkSettings }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const firstOpen = plan.days.find((d) => !d.isPast)?.key ?? null;
  const [openDay, setOpenDay] = useState<string | null>(firstOpen);
  const t = plan.totals;

  return (
    <Card size="sm">
      <CardContent className="space-y-4">
        {/* encabezado */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Semana {plan.weekLabel}</span>
            <div className="flex rounded-md bg-muted p-0.5">
              {[0, 1].map((o) => (
                <Link
                  key={o}
                  href={`/?semana=${o}`}
                  scroll={false}
                  className={cn(
                    "rounded px-2 py-0.5 transition-all",
                    plan.offset === o ? "bg-background font-medium text-foreground shadow-sm" : "hover:text-foreground",
                  )}
                >
                  {o === 0 ? "Esta" : "Próxima"}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {refreshing ? "Actualizando" : "Actualizar"}
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="Ajustar jornada">
              <Settings2 />
            </Button>
          </div>
        </div>

        {/* veredicto + métricas */}
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <Verdict plan={plan} settings={settings} />
          <Metric
            label="Reuniones"
            value={String(t.meetingCount)}
            hint={`${fmt(t.meetingBusyHours)} · ${t.clientMeetingCount} con clientes`}
          />
          <Metric
            label="Libre para accionables"
            value={fmt(t.freeCoreHours)}
            hint={t.freeFlexHours ? `+${fmt(t.freeFlexHours)} en horario flexible` : "horario normal"}
          />
          <Metric
            label="Accionables pendientes"
            value={String(t.pendingCount)}
            hint={`≈${fmt(t.pendingHours)} (${fmt(settings.hoursPerActionable)} c/u)`}
          />
          <Metric
            label="Meta diaria"
            value={`${t.dailyTarget}/día`}
            hint={`${t.remainingDays} día${t.remainingDays === 1 ? "" : "s"} hasta el viernes`}
          />
        </div>

        {/* días */}
        <div className="space-y-1">
          <div className="flex items-center gap-3 pl-[7.25rem] pr-[6.75rem] text-[10px] text-muted-foreground max-sm:hidden">
            <div className="relative h-3 flex-1">
              {plan.hourTicks.map((tk) => (
                <span key={tk.label} className="absolute -translate-x-1/2" style={{ left: `${tk.at * 100}%` }}>
                  {tk.label}
                </span>
              ))}
            </div>
          </div>
          {plan.days.map((d) => (
            <DayRow
              key={d.key}
              day={d}
              plan={plan}
              open={openDay === d.key}
              onToggle={() => setOpenDay((o) => (o === d.key ? null : d.key))}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {(["client", "other", "task", "lunch"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", BLOCK_CLASS[k])} />
              {KIND_LABEL[k]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-foreground/[0.06] ring-1 ring-foreground/15 ring-inset" />
            Horario flexible ({settings.workStart}–{settings.coreStart} · {settings.coreEnd}–{settings.workEnd})
          </span>
          <span className="ml-auto">
            {plan.source === "calendar" ? "Desde tu Google Calendar" : "Calendar no conectado"}
          </span>
        </div>
      </CardContent>

      <WorkSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
    </Card>
  );
}

function Verdict({ plan, settings }: { plan: WeekPlan; settings: WorkSettings }) {
  const t = plan.totals;
  const tone = t.verdict === "deficit" ? "bad" : t.verdict === "flex" ? "warn" : "good";
  const title =
    t.verdict === "empty"
      ? "Sin accionables pendientes"
      : t.verdict === "core"
        ? `Llegas: terminas el ${t.finishLabel}`
        : t.verdict === "flex"
          ? `Llegas extendiendo ${fmt(t.flexNeededHours)}`
          : `No llegas: faltan ${fmt(t.unscheduledHours)}`;
  const hint =
    t.verdict === "empty"
      ? "Tu semana queda libre de pendientes"
      : t.verdict === "core"
        ? `En horario normal, con ${fmt(Math.max(0, Math.round((t.freeCoreHours - t.pendingHours) * 10) / 10))} de margen`
        : t.verdict === "flex"
          ? `Arrancando ${settings.workStart} o terminando ${settings.workEnd} · cierre ${t.finishLabel}`
          : `≈${Math.ceil(t.unscheduledHours / settings.hoursPerActionable)} accionables no entran antes del viernes`;
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? Clock3 : AlertTriangle;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg p-3 sm:col-span-2 lg:col-span-1",
        tone === "good" && "bg-emerald-500/10",
        tone === "warn" && "bg-amber-500/10",
        tone === "bad" && "bg-red-500/10",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground" title={hint}>{hint}</p>
    </div>
  );
}

function DayRow({
  day: d,
  plan,
  open,
  onToggle,
}: {
  day: PlanDay;
  plan: WeekPlan;
  open: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { coreFrom, coreTo } = plan.window;

  return (
    <div className={cn("rounded-lg transition-colors", open && "bg-muted/40", d.isPast && "opacity-55")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex w-24 shrink-0 items-center gap-1">
          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="min-w-0">
            <span className={cn("block text-xs capitalize", d.isToday ? "font-semibold" : "font-medium")}>
              {d.label}
              {d.isToday && <span className="ml-1 text-[10px] font-normal text-muted-foreground">hoy</span>}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {d.meetingCount} reunion{d.meetingCount === 1 ? "" : "es"}
            </span>
          </span>
        </span>

        {/* timeline */}
        <span className="relative block h-7 min-w-0 flex-1 rounded-md bg-foreground/[0.06]">
          <span
            className="absolute inset-y-0 rounded-sm bg-muted"
            style={{ left: `${coreFrom * 100}%`, width: `${(coreTo - coreFrom) * 100}%` }}
          />
          {plan.hourTicks.map((tk) => (
            <span key={tk.label} className="absolute inset-y-0 w-px bg-foreground/[0.07]" style={{ left: `${tk.at * 100}%` }} />
          ))}
          {d.blocks.map((b, i) => (
            <Block key={i} block={b} active={hover === i} onEnter={() => setHover(i)} onLeave={() => setHover(null)} />
          ))}
          {d.elapsed > 0 && (
            <span
              className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-background/60"
              style={{ width: `${d.elapsed * 100}%` }}
            />
          )}
          {d.isToday && d.elapsed > 0 && d.elapsed < 1 && (
            <span className="pointer-events-none absolute -inset-y-1 w-0.5 rounded bg-foreground" style={{ left: `${d.elapsed * 100}%` }} />
          )}
        </span>

        <span className="w-[5.5rem] shrink-0 text-right text-[11px] leading-tight tabular-nums">
          {d.isPast ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              <span className="block font-medium">{fmt(d.freeCoreHours)} libre</span>
              {d.freeFlexHours > 0 && <span className="block text-muted-foreground">+{fmt(d.freeFlexHours)} flex</span>}
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="grid gap-4 px-3 pt-1 pb-3 sm:grid-cols-2 sm:pl-[7.75rem]">
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">Agenda</p>
            {d.agenda.length ? (
              <ul className="space-y-1">
                {d.agenda.map((b, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className={cn("h-3.5 w-1 shrink-0 rounded-full", BLOCK_CLASS[b.kind])} />
                    <span className="w-[5.5rem] shrink-0 tabular-nums text-muted-foreground">
                      {b.startLabel}–{b.endLabel}
                    </span>
                    <span className="min-w-0 truncate">
                      {b.title}
                      {b.accountName && b.kind === "client" && (
                        <span className="text-muted-foreground"> · {b.accountName}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Sin reuniones.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              Espacios para accionables
              {d.taskCount > 0 && (
                <span className="font-normal"> · planificados ≈{d.taskCount} ({fmt(d.taskHours)})</span>
              )}
            </p>
            {d.gaps.length ? (
              <div className="flex flex-wrap gap-1.5">
                {d.gaps.map((g, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs tabular-nums",
                      g.flex ? "border border-dashed border-foreground/20 text-muted-foreground" : "bg-series-2/15",
                    )}
                    title={g.flex ? "Horario flexible" : "Horario normal"}
                  >
                    {g.startLabel}–{g.endLabel} <span className="text-muted-foreground">· {fmtMin(g.minutes)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{d.isPast ? "Día terminado." : "Sin huecos libres."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Block({
  block: b,
  active,
  onEnter,
  onLeave,
}: {
  block: PlanBlock;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const left = b.from * 100;
  return (
    <span
      className="absolute inset-y-0.5 block px-px"
      style={{ left: `${left}%`, width: `${Math.max(0.6, (b.to - b.from) * 100)}%` }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <span
        className={cn(
          "block h-full rounded-[3px]",
          BLOCK_CLASS[b.kind],
          b.kind === "task" && b.soft && "opacity-55",
          active && "brightness-110",
        )}
      />
      {active && (
        <span
          className={cn(
            "pointer-events-none absolute bottom-full z-20 mb-1.5 block w-56 rounded-lg bg-popover p-2.5 text-left text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            left > 60 ? "right-0" : "left-0",
          )}
        >
          <span className="block font-medium">{b.title}</span>
          <span className="block text-muted-foreground">
            {b.startLabel}–{b.endLabel} · {KIND_LABEL[b.kind]}
            {b.soft && b.kind === "task" && " en horario flexible"}
          </span>
          {b.accountName && b.kind === "client" && <span className="block text-muted-foreground">Cuenta: {b.accountName}</span>}
        </span>
      )}
    </span>
  );
}
