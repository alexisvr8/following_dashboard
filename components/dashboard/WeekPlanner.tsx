"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkSettingsDialog } from "@/components/dashboard/WorkSettingsDialog";
import { cn } from "@/lib/utils";
import { toMinutes } from "@/lib/utils/capacity";
import type { BlockKind, PlanBlock, PlanDay, WeekPlan } from "@/lib/utils/week-plan";
import type { WorkSettings } from "@/lib/store/settings-store";

const fmt = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
const fmtMin = (m: number) => (m < 60 ? `${m}m` : fmt(Math.round((m / 60) * 10) / 10));

// Muestra de color de cada categoría (leyenda y agenda).
const BLOCK_CLASS: Record<BlockKind, string> = {
  client: "bg-cal-client",
  other: "bg-cal-other",
  task: "bg-cal-task",
  lunch: "bg-[repeating-linear-gradient(135deg,var(--cal-lunch)_0_1.5px,transparent_1.5px_6px)]",
};

// Bloques compactos: fondo tenue + borde izquierdo de color, legibles en ambos temas.
const BLOCK_CARD: Record<BlockKind, string> = {
  client: "border-cal-client bg-cal-client/22",
  other: "border-cal-other bg-cal-other/18",
  task: "border-cal-task bg-cal-task/22",
  lunch:
    "border-cal-lunch/60 bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--cal-lunch)_25%,transparent)_0_1.5px,transparent_1.5px_6px)]",
};

const KIND_LABEL: Record<BlockKind, string> = {
  client: "Reunión con cliente",
  other: "Otra reunión",
  task: "Accionables (proyectado)",
  lunch: "Almuerzo",
};

// Planificador semanal: encabezado, 5 tarjetas resumen, calendario proporcional y tarjeta de
// agenda/huecos. En ≥1280px ocupa el alto que le da el Dashboard (sin scroll de página): la jornada
// se reparte ese alto y cada bloque mide según su duración.
export function WeekPlanner({ plan, settings }: { plan: WeekPlan; settings: WorkSettings }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const firstOpen = plan.days.find((d) => !d.isPast)?.key ?? null;
  const [openDay, setOpenDay] = useState<string | null>(firstOpen);
  const t = plan.totals;
  const selectedDay = plan.days.find((d) => d.key === openDay);

  return (
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0">
      {/* 1. Barra de encabezado */}
      <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-label-sm uppercase text-subtle-foreground">Capacidad</h2>
          <span className="truncate text-xs text-muted-foreground">Semana {plan.weekLabel}</span>
          <div className="flex shrink-0 rounded-md border border-border bg-surface p-0.5 text-xs">
            {[0, 1].map((o) => (
              <Link
                key={o}
                href={`/?semana=${o}`}
                scroll={false}
                className={cn(
                  "rounded-sm px-2 py-0.5 transition-colors",
                  plan.offset === o ? "bg-accent font-medium text-foreground-strong" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o === 0 ? "Esta" : "Próxima"}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? "Actualizando" : "Actualizar"}
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="Ajustar jornada">
            <Settings2 />
          </Button>
        </div>
      </div>

      {/* 2. Cinco tarjetas resumen: una sola fila, mismo ancho (scroll horizontal en pantallas chicas) */}
      <div className="shrink-0 max-md:overflow-x-auto max-md:pb-1">
        <div className="grid grid-cols-5 gap-2 max-md:min-w-[46rem]">
          <Verdict plan={plan} settings={settings} />
          <Metric label="Reuniones" value={String(t.meetingCount)} hint={`${fmt(t.meetingBusyHours)} · ${t.clientMeetingCount} con clientes`} />
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
      </div>

      {/* 3. Grilla semanal: toma el alto que queda */}
      <Card size="sm" className="py-0 xl:min-h-0 xl:flex-1">
        <div className="max-md:overflow-x-auto xl:h-full">
          <WeekGrid
            plan={plan}
            settings={settings}
            openDay={openDay}
            onToggleDay={(k) => setOpenDay((o) => (o === k ? null : k))}
          />
        </div>
      </Card>

      {/* 4. Agenda del día + espacios para accionables + leyenda (compacta, siempre entera) */}
      <Card size="sm" className="shrink-0">
        <CardContent className="space-y-2.5">
          {selectedDay ? (
            <DayDetail day={selectedDay} />
          ) : (
            <p className="text-xs text-muted-foreground">Elegí un día en la grilla para ver su agenda y los espacios libres.</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
            {(["client", "other", "task", "lunch"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-sm", BLOCK_CLASS[k])} />
                {KIND_LABEL[k]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-dashed border-cal-flex bg-surface" />
              Horario flexible ({settings.workStart}–{settings.coreStart} · {settings.coreEnd}–{settings.workEnd})
            </span>
            <span className="ml-auto text-subtle-foreground">
              {plan.source === "calendar" ? "Desde tu Google Calendar" : "Calendar no conectado"}
            </span>
          </div>
        </CardContent>
      </Card>

      <WorkSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
    </div>
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
      title={`${title} — ${hint}`}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2",
        tone === "good" && "border-success/25 bg-success-muted",
        tone === "warn" && "border-warning/25 bg-warning-muted",
        tone === "bad" && "border-critical/25 bg-critical-muted",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "good" && "text-success",
          tone === "warn" && "text-warning",
          tone === "bad" && "text-critical",
        )}
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div title={`${label}: ${value} — ${hint}`} className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2">
      <p className="truncate text-label-sm uppercase text-subtle-foreground">{label}</p>
      <p className="truncate font-mono text-base font-medium leading-tight text-foreground-strong tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

const HOUR_PX = 60; // alto por hora cuando la página scrollea (<1280px)

type LaidOutBlock = { block: PlanBlock; lane: number; lanes: number };

// Reparte en carriles los bloques que se solapan (como Google Calendar) para que no se tapen.
function layoutBlocks(blocks: PlanBlock[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.from - b.from || b.to - a.to);
  const out: LaidOutBlock[] = [];
  let cluster: PlanBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    const placed = cluster.map((block) => {
      const free = laneEnds.findIndex((end) => end <= block.from);
      const lane = free < 0 ? laneEnds.length : free;
      laneEnds[lane] = block.to;
      return { block, lane };
    });
    for (const p of placed) out.push({ ...p, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };
  for (const b of sorted) {
    if (cluster.length && b.from >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.to);
  }
  flush();
  return out;
}

/**
 * Calendario estilo Google Calendar: columna de horas + un carril por día, bloques con alto
 * proporcional a su duración. En ≥1280px la jornada se reparte el alto disponible (sin scroll).
 */
function WeekGrid({
  plan,
  settings,
  openDay,
  onToggleDay,
}: {
  plan: WeekPlan;
  settings: WorkSettings;
  openDay: string | null;
  onToggleDay: (key: string) => void;
}) {
  const columns = `3rem repeat(${plan.days.length}, minmax(0, 1fr))`;
  const hours = Math.max(1, (toMinutes(settings.workEnd) - toMinutes(settings.workStart)) / 60);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(hours * HOUR_PX);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col max-md:min-w-[40rem] xl:h-full">
      <div className="grid shrink-0" style={{ gridTemplateColumns: columns }}>
        <div className="border-b border-border" />
        {plan.days.map((d) => (
          <DayHeader key={d.key} day={d} open={openDay === d.key} onToggle={() => onToggleDay(d.key)} />
        ))}
      </div>
      <div
        ref={bodyRef}
        className="grid h-(--grid-h) xl:h-auto xl:min-h-0 xl:flex-1"
        style={{ gridTemplateColumns: columns, ["--grid-h" as string]: `${hours * HOUR_PX}px` }}
      >
        <div className="relative text-label-sm text-subtle-foreground">
          {plan.hourTicks.map((tk) => (
            <span
              key={tk.label}
              className={cn(
                "absolute right-1.5",
                // la primera y la última hora quedan dentro del área (no se cortan)
                tk.at <= 0 ? "translate-y-0.5" : tk.at >= 1 ? "-translate-y-full" : "-translate-y-1/2",
              )}
              style={{ top: `${tk.at * 100}%` }}
            >
              {tk.label}:00
            </span>
          ))}
        </div>
        {plan.days.map((d, i) => (
          <DayColumn key={d.key} day={d} plan={plan} bodyHeight={bodyHeight} alignRight={i >= plan.days.length / 2} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day: d,
  plan,
  bodyHeight,
  alignRight,
}: {
  day: PlanDay;
  plan: WeekPlan;
  bodyHeight: number;
  alignRight: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { coreFrom, coreTo } = plan.window;

  return (
    <div className="relative border-l border-border bg-surface">
      {/* horario normal sobre fondo card; el flexible queda en surface */}
      <div className="absolute inset-x-0 bg-card" style={{ top: `${coreFrom * 100}%`, height: `${(coreTo - coreFrom) * 100}%` }} />
      {plan.hourTicks.map((tk) => (
        <div key={tk.label} className="absolute inset-x-0 h-px bg-row-divider" style={{ top: `${tk.at * 100}%` }} />
      ))}
      {layoutBlocks(d.blocks).map((item, i) => (
        <Block
          key={i}
          {...item}
          bodyHeight={bodyHeight}
          alignRight={alignRight}
          active={hover === i}
          onEnter={() => setHover(i)}
          onLeave={() => setHover(null)}
        />
      ))}
      {d.elapsed > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-background/60"
          style={{ height: `${Math.min(1, d.elapsed) * 100}%` }}
        />
      )}
      {d.isToday && d.elapsed > 0 && d.elapsed < 1 && (
        <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-foreground" style={{ top: `${d.elapsed * 100}%` }}>
          <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-foreground" />
        </div>
      )}
    </div>
  );
}

function blockName(b: PlanBlock) {
  return b.kind === "task" ? (b.accountName ?? b.title) : b.title;
}

function blockTooltip(b: PlanBlock): string {
  return [
    blockName(b),
    `${b.startLabel}–${b.endLabel} · ${KIND_LABEL[b.kind]}${b.kind === "task" && b.soft ? " en horario flexible" : ""}`,
    b.accountName && b.kind === "client" ? `Cuenta: ${b.accountName}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Bloque proporcional a su duración: título y, si hay alto, el horario debajo. Hover = detalle. */
function Block({
  block: b,
  lane,
  lanes,
  bodyHeight,
  alignRight,
  active,
  onEnter,
  onLeave,
}: LaidOutBlock & {
  bodyHeight: number;
  alignRight: boolean;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const px = (b.to - b.from) * bodyHeight;
  const softTask = b.kind === "task" && b.soft;
  return (
    <div
      className="absolute p-px"
      style={{
        top: `${b.from * 100}%`,
        height: `${(b.to - b.from) * 100}%`,
        minHeight: 8,
        left: `${(lane / lanes) * 100}%`,
        width: `${100 / lanes}%`,
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {/* bg-card opaco debajo del tinte: las líneas de hora no atraviesan el texto */}
      <div className="h-full overflow-hidden rounded-sm bg-card">
        <div
          className={cn(
            "h-full border-l-[3px] px-1.5 leading-tight",
            BLOCK_CARD[b.kind],
            softTask && "border-dashed bg-cal-task/10",
            b.kind === "lunch" && "text-muted-foreground",
            active && "brightness-125",
          )}
        >
          {px >= 14 && <p className={cn("truncate text-[11px] font-medium", px >= 20 && "pt-0.5")}>{blockName(b)}</p>}
          {px >= 32 && (
            <p className="truncate text-[10px] text-muted-foreground tabular">
              {b.startLabel}–{b.endLabel}
            </p>
          )}
        </div>
      </div>
      {active && (
        <div
          className={cn(
            "pointer-events-none absolute z-20 w-56 rounded-md border border-border-strong bg-popover p-2.5 text-left text-xs text-popover-foreground shadow-popover",
            b.from > 0.35 ? "bottom-full mb-1.5" : "top-full mt-1.5",
            alignRight ? "right-0" : "left-0",
          )}
        >
          <span className="block font-medium">{b.title}</span>
          <span className="block text-muted-foreground">
            {b.startLabel}–{b.endLabel} · {KIND_LABEL[b.kind]}
            {softTask && " en horario flexible"}
          </span>
          {b.accountName && b.kind === "client" && <span className="block text-muted-foreground">Cuenta: {b.accountName}</span>}
        </div>
      )}
    </div>
  );
}

function DayHeader({ day: d, open, onToggle }: { day: PlanDay; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "min-w-0 border-b border-l border-border px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
        open && "bg-accent/60",
        d.isPast && "opacity-55",
      )}
    >
      <span className={cn("block truncate text-xs capitalize", d.isToday ? "font-semibold text-foreground-strong" : "font-medium")}>
        {d.label}
        {d.isToday && <span className="ml-1 text-[10px] font-normal text-muted-foreground">hoy</span>}
      </span>
      <span className="block truncate text-[10px] tabular text-muted-foreground">
        {d.meetingCount} reunion{d.meetingCount === 1 ? "" : "es"}
        {!d.isPast && ` · ${fmt(d.freeCoreHours)} libre`}
        {!d.isPast && d.freeFlexHours > 0 && ` +${fmt(d.freeFlexHours)}`}
      </span>
    </button>
  );
}

/** Agenda en columnas (no crece hacia abajo) + huecos como chips. */
function DayDetail({ day: d }: { day: PlanDay }) {
  return (
    <div className="grid gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-1">
        <p className="text-label-sm uppercase text-subtle-foreground">
          Agenda · <span className="capitalize">{d.label}</span>
        </p>
        {d.agenda.length ? (
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 2xl:grid-cols-3">
            {d.agenda.map((b, i) => (
              <li key={i} className="flex min-w-0 items-center gap-2 text-xs" title={blockTooltip(b)}>
                <span className={cn("h-3 w-1 shrink-0 rounded-full", BLOCK_CLASS[b.kind])} />
                <span className="shrink-0 text-[11px] tabular text-muted-foreground">{b.startLabel}</span>
                <span className="min-w-0 truncate">
                  {b.title}
                  {b.accountName && b.kind === "client" && <span className="text-muted-foreground"> · {b.accountName}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sin reuniones.</p>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-label-sm uppercase text-subtle-foreground">
          Espacios para accionables
          {d.taskCount > 0 && (
            <span className="normal-case">
              {" "}
              · planificados ≈{d.taskCount} ({fmt(d.taskHours)})
            </span>
          )}
        </p>
        {d.gaps.length ? (
          <div className="flex flex-wrap gap-1.5">
            {d.gaps.map((g, i) => (
              <span
                key={i}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] tabular",
                  g.flex ? "border border-dashed border-cal-flex text-muted-foreground" : "border border-cal-task/30 bg-cal-task/10",
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
  );
}
