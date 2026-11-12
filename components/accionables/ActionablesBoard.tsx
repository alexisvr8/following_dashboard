"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Columns3, Handshake, History, List, Mail, PencilLine, Search, Target, Users } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DueKind, PlannedItem, SuggestedItem } from "@/lib/utils/deadlines";
import { ActionablePanel, type PanelAction } from "@/components/accionables/ActionablePanel";
import { SuggestionsDialog } from "@/components/accionables/SuggestionsSection";
import { CorrectionsDialog } from "@/components/accionables/CorrectionsDialog";
import {
  COLUMNS,
  fmtMinutes,
  originLabel,
  addCorrection,
  ownMinutes,
  patchClient,
  PRIORITY,
  relativeDue,
  saveRole,
  type Role,
  VIEW_COOKIE,
} from "@/components/accionables/format";

// Accionables por plazo. Dos vistas (Tablero de columnas / Lista a todo el ancho) con el mismo orden:
// plazo → accionable (lo que vence antes primero). La card muestra siempre lo mismo en el mismo
// lugar; el detalle y la edición (texto, responsables, lado, fecha, estimación, hecho, no corresponde) van en
// el modal. Arriba, los sugeridos de la transcripción. Lo que se corrige (nombres, roles, estimaciones,
// descartes) se aprende para las minutas siguientes.

type Side = "todo" | "debo" | "me_deben";
type View = "board" | "list";
const TONE_TEXT = { critical: "text-critical", warning: "text-warning", muted: "text-muted-foreground" } as const;
const DUE_ICON: Record<DueKind, typeof Target> = { agreed: Handshake, target: Target, manual: PencilLine };
const DUE_HINT: Record<DueKind, string> = {
  agreed: "Fecha acordada en la reunión o el mail",
  target: "Meta interna (no se dijo fecha)",
  manual: "Fecha puesta a mano",
};

export function ActionablesBoard({
  items,
  weekLabel,
  calendarConnected,
  freeHours,
  workDays,
  targetDays,
  limitDays,
  initialView,
  suggestions,
  people,
  corrections,
}: {
  initialView: View;
  suggestions: SuggestedItem[];
  people: Record<string, Role>;
  corrections: { from: string; to: string }[];
  items: PlannedItem[];
  weekLabel: string;
  calendarConnected: boolean;
  freeHours: number;
  workDays: number[];
  targetDays: number;
  limitDays: number;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [side, setSide] = useState<Side>("debo");
  const [account, setAccount] = useState("");
  const [query, setQuery] = useState("");
  const [onlyCarried, setOnlyCarried] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const changeView = (v: View) => {
    setView(v);
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  };

  const accounts = useMemo(
    () => [...new Map(items.map((i) => [i.clientId, i.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")),
    [items],
  );
  const open = items.filter((i) => !hidden.has(i.id));
  const visible = open.filter((i) => {
    if (side !== "todo" && i.side !== side) return false;
    if (account && i.clientId !== account) return false;
    if (onlyCarried && !i.carried) return false;
    const q = query.trim().toLowerCase();
    return !q || `${i.title} ${i.detail ?? ""} ${i.clientName} ${i.owners.join(" ")}`.toLowerCase().includes(q);
  });
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const carriedOverdue = open.filter((i) => i.carried && i.bucket === "overdue" && (side === "todo" || i.side === side)).length;

  const counters = [
    { label: "Vencidos", value: open.filter((i) => i.bucket === "overdue").length, tone: "critical" as const },
    { label: "Para hoy", value: open.filter((i) => i.bucket === "today").length, tone: "warning" as const },
    { label: "Me deben", value: open.filter((i) => i.side === "me_deben").length, tone: "neutral" as const },
    {
      label: calendarConnected ? `Sin hueco en la agenda (${weekLabel})` : "Sin hueco (Calendar no conectado)",
      value: open.filter((i) => i.atRisk).length,
      tone: "critical" as const,
    },
  ];

  function bodyFor(item: PlannedItem, action: PanelAction): unknown {
    switch (action.type) {
      case "done":
        return { ticketId: item.id, isDone: true };
      case "remove":
        return { actionable: { op: "remove", id: item.id } };
      case "due":
        return { plan: { ticketId: item.id, due: action.due } };
      case "estimate":
        return { plan: { ticketId: item.id, estimateMinutes: action.minutes } };
      case "side":
        return { plan: { ticketId: item.id, side: action.side } };
      case "edit":
        return { actionable: { op: "edit", id: item.id, title: action.text } };
      default:
        return null;
    }
  }

  async function act(item: PlannedItem, action: PanelAction) {
    const hide = action.type === "done" || action.type === "remove";
    setBusy(item.id);
    if (hide) {
      setHidden((h) => new Set(h).add(item.id));
      if (selectedId === item.id) setSelectedId(null);
    }
    const ok =
      action.type === "role"
        ? await saveRole(people, action.name, action.role)
        : action.type === "correction"
          ? await addCorrection(action.from, action.to)
          : await patchClient(item.clientId, bodyFor(item, action));
    if (!ok && hide) {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(item.id);
        return next;
      });
    }
    setBusy(null);
    router.refresh();
  }

  const itemProps = { onOpen: setSelectedId, onDone: (i: PlannedItem) => act(i, { type: "done" }) };

  const [resolved, setResolved] = useState<Set<string>>(new Set());
  // En el modal se ven todas (no dependen del filtro Debo / Me deben del tablero), salvo el filtro de cuenta.
  const pendingSuggestionsList = suggestions.filter((s) => !resolved.has(s.id) && (!account || s.clientId === account));
  async function resolveSuggestion(s: SuggestedItem, action: "accept" | "dismiss", text?: string) {
    setBusy(s.id);
    setResolved((r) => new Set(r).add(s.id));
    const title = text?.trim() ? `${s.owner ? `[${s.owner}] ` : ""}${text.trim()}` : undefined;
    const ok = await patchClient(s.clientId, { suggestion: { suggestionId: s.id, action, title, due: action === "accept" ? s.due : null } });
    if (!ok) {
      setResolved((r) => {
        const next = new Set(r);
        next.delete(s.id);
        return next;
      });
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Contadores */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {counters.map((c) => (
          <div key={c.label} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <StatusDot tone={c.value ? c.tone : "neutral"} />
              <span className="truncate">{c.label}</span>
            </span>
            <span className="tabular text-lg font-medium text-foreground-strong">{c.value}</span>
          </div>
        ))}
      </div>

      {/* Filtros + vista */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Filtrar por lado"
          value={side}
          onChange={setSide}
          options={[
            ["debo", "Debo"],
            ["me_deben", "Me deben"],
            ["todo", "Todo"],
          ]}
        />
        <select
          aria-label="Cuenta"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className={cn(inputClass, "h-8 w-auto max-w-56 text-xs")}
        >
          <option value="">Todas las cuentas</option>
          {accounts.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar accionable o responsable"
            className={cn(inputClass, "h-8 pl-8 text-xs")}
          />
        </label>
        <button
          type="button"
          aria-pressed={onlyCarried}
          onClick={() => setOnlyCarried((v) => !v)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
            onlyCarried ? "border-border-strong bg-accent text-foreground" : "border-input bg-surface text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="size-3.5" /> Solo arrastrados
        </button>
        <SuggestionsDialog suggestions={pendingSuggestionsList} busy={busy} onResolve={resolveSuggestion} />
        <CorrectionsDialog corrections={corrections} />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground lg:inline">
            Tuyo: <b className="tabular font-medium text-foreground">{fmtMinutes(ownMinutes(open))}</b>
            {calendarConnected && (
              <>
                {" "}· libre: <b className="tabular font-medium text-foreground">{Math.round(freeHours * 10) / 10} h</b>
              </>
            )}
          </span>
          <Segmented
            label="Vista"
            value={view}
            onChange={changeView}
            options={[
              ["board", <><Columns3 className="size-3.5" /> Tablero</>],
              ["list", <><List className="size-3.5" /> Lista</>],
            ]}
          />
        </div>
      </div>

      {/* Leyenda */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground">
        {(["agreed", "target", "manual"] as const).map((k) => {
          const Icon = DUE_ICON[k];
          return (
            <span key={k} className="flex items-center gap-1">
              <Icon className="size-3.5" />
              {k === "agreed" ? "Acordada: se dijo en la reunión o el mail" : k === "target" ? `Meta interna: ${targetDays} días hábiles si no se dijo fecha (vence a los ${limitDays})` : "Manual: la pusiste vos"}
            </span>
          );
        })}
        <span>· Click en un accionable para ver el detalle y editarlo.</span>
      </p>

      {carriedOverdue > 0 && !onlyCarried && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
          <span>
            <b className="tabular font-medium">{carriedOverdue}</b> vencido{carriedOverdue === 1 ? "" : "s"} vienen de minutas anteriores.
            Revisalos: marcá hecho, quitá lo que no corresponde o reprogramá.
          </span>
          <button type="button" onClick={() => setOnlyCarried(true)} className="font-medium text-warning hover:underline">
            Revisar arrastrados
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No hay accionables con estos filtros.
        </p>
      ) : view === "board" ? (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const list = visible.filter((i) => i.bucket === col.key);
            return (
              <section key={col.key} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-2">
                <ColumnHeader label={col.label} tone={col.tone} items={list} />
                {list.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-subtle-foreground">Nada acá</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {list.map((i) => (
                      <ItemCard key={i.id} item={i} busy={busy === i.id} {...itemProps} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {COLUMNS.map((col) => {
            const list = visible.filter((i) => i.bucket === col.key);
            if (!list.length) return null;
            return (
              <section key={col.key} className="space-y-1.5">
                <ColumnHeader label={col.label} tone={col.tone} items={list} />
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {list.map((i) => (
                    <ItemRow key={i.id} item={i} busy={busy === i.id} {...itemProps} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <ActionablePanel
        item={selected}
        open={!!selected}
        busy={busy === selected?.id}
        workDays={workDays}
        targetDays={targetDays}
        limitDays={limitDays}
        people={people}
        onOpenChange={(o) => !o && setSelectedId(null)}
        onAction={act}
      />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, React.ReactNode][];
}) {
  return (
    <div className="flex rounded-md border border-input bg-surface p-0.5" role="group" aria-label={label}>
      {options.map(([key, content]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
            value === key ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {content}
        </button>
      ))}
    </div>
  );
}

function ColumnHeader({ label, tone, items }: { label: string; tone: "critical" | "warning" | "neutral"; items: PlannedItem[] }) {
  const minutes = ownMinutes(items);
  return (
    <header className="flex items-center justify-between gap-2 px-1 pt-0.5">
      <h2 className="flex items-center gap-2 text-label-sm uppercase text-subtle-foreground">
        <StatusDot tone={items.length ? tone : "neutral"} />
        {label}
        <span className="tabular">{items.length}</span>
      </h2>
      {minutes > 0 && <span className="tabular text-label-sm text-subtle-foreground">{fmtMinutes(minutes)}</span>}
    </header>
  );
}

type ItemProps = { item: PlannedItem; busy: boolean; onOpen: (id: string) => void; onDone: (item: PlannedItem) => void };

function DoneBox({ item, busy, onDone }: Omit<ItemProps, "onOpen">) {
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex">
      <Checkbox
        aria-label="Marcar hecho"
        disabled={busy}
        onCheckedChange={(v) => v === true && onDone(item)}
      />
    </span>
  );
}

function DueLine({ item }: { item: PlannedItem }) {
  const rel = relativeDue(item);
  const Icon = DUE_ICON[item.dueKind];
  return (
    <span className={cn("flex items-center gap-1 font-medium", TONE_TEXT[rel.tone])} title={`${DUE_HINT[item.dueKind]} · ${item.dueLabel}`}>
      <Icon className="size-3.5 shrink-0" />
      {rel.text}
    </span>
  );
}

function SideLine({ item }: { item: PlannedItem }) {
  if (item.side === "debo") return <Badge variant="secondary">Debo</Badge>;
  const who = item.owners[0]?.split(/\s+/)[0];
  return <Badge variant="outline">Me deben{who ? ` · ${who}` : ""}</Badge>;
}

function ItemCard({ item, busy, onOpen, onDone }: ItemProps) {
  const OriginIcon = item.originKind === "mail" ? Mail : Users;
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(item.id))}
      className={cn(
        "flex cursor-pointer flex-col gap-1.5 rounded-lg border border-l-2 border-border bg-card px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:border-border-strong hover:shadow-highlight focus-visible:border-ring",
        PRIORITY[item.priority].stripe,
        busy && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium text-foreground" title={item.erp ? `${item.clientName} · ${item.erp}` : item.clientName}>
            {item.clientName}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-label-sm text-subtle-foreground">
            <OriginIcon className="size-3 shrink-0" />
            <span className="truncate">{originLabel(item)}</span>
            {item.carried && <span className="shrink-0">· arrastrado</span>}
          </span>
        </span>
        <DoneBox item={item} busy={busy} onDone={onDone} />
      </div>
      <p className="line-clamp-2 text-[13px] leading-snug font-medium text-foreground-strong">{item.title}</p>
      {item.detail && <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{item.detail}</p>}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border pt-1.5 text-[11px]">
        <DueLine item={item} />
        <span className="tabular text-muted-foreground">{fmtMinutes(item.estimateMinutes)}</span>
        <span className="ml-auto">
          <SideLine item={item} />
        </span>
      </div>
      {item.atRisk && <p className="text-[11px] text-critical">Sin espacio en la agenda</p>}
    </li>
  );
}

function ItemRow({ item, busy, onOpen, onDone }: ItemProps) {
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(item.id))}
      className={cn(
        "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 border-l-2 px-3 py-2.5 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 md:grid-cols-[auto_minmax(0,1fr)_150px_70px_150px] md:items-center",
        PRIORITY[item.priority].stripe,
        busy && "opacity-60",
      )}
    >
      <DoneBox item={item} busy={busy} onDone={onDone} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground-strong">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{item.clientName}</span> · {originLabel(item)}
          {item.carried && " · arrastrado"}
          {item.detail && ` · ${item.detail}`}
        </span>
      </span>
      <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] md:contents">
        <DueLine item={item} />
        <span className="tabular text-muted-foreground">{fmtMinutes(item.estimateMinutes)}</span>
        <span className="flex items-center gap-1.5 md:justify-end">
          {item.atRisk && <StatusDot tone="critical" />}
          <SideLine item={item} />
        </span>
      </span>
    </li>
  );
}
