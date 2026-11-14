"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronDown,
  Columns3,
  Handshake,
  History,
  List,
  Mail,
  Pencil,
  PencilLine,
  Rows2,
  Rows4,
  Search,
  Send,
  Sparkles,
  Target,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Bucket, DueKind, PlannedItem, SuggestedItem } from "@/lib/utils/deadlines";
import { ActionablePanel, type PanelAction } from "@/components/accionables/ActionablePanel";
import { SuggestionsDialog } from "@/components/accionables/SuggestionsSection";
import { RewritesDialog } from "@/components/accionables/RewritesDialog";
import { AttentionBadge } from "@/components/cuentas/AttentionToggle";
import type { RewriteItem } from "@/lib/utils/account-analysis";
import { CorrectionsDialog } from "@/components/accionables/CorrectionsDialog";
import { FollowupPanel, type FollowupPanelData } from "@/components/dashboard/FollowupPanel";
import {
  addWorkdays,
  carriedAge,
  boardGroups,
  groupOf,
  type BoardGroup,
  movedItem,
  MAIL_ACTION_LABEL,
  isMailItem,
  CLOSE_DELAY_MS,
  cardTone,
  type CardTone,
  COLUMNS,
  DENSITY_COOKIE,
  dropDue,
  DUE_KIND,
  fmtMinutes,
  fmtShortDate,
  isoDay,
  originLabel,
  addCorrection,
  ownMinutes,
  patchClient,
  relativeDue,
  saveRole,
  type Role,
  VIEW_COOKIE,
} from "@/components/accionables/format";

// Accionables por plazo. Dos vistas (Tablero de columnas / Lista a todo el ancho) con el mismo orden:
// plazo → arrastrados primero (el más viejo arriba, en violeta) → el resto por fecha y prioridad. Click en la card
// la despliega ahí mismo (texto completo, origen, responsables, Hecho / +1 día / Reclamar / Cuenta); la edición a
// fondo (texto, responsables, lado, fecha, estimación, no corresponde) sigue en el modal ("Editar"). En el tablero,
// soltar una card en otra columna le pone fecha manual. Densidad cómoda / compacta (cookie). Lo que se corrige
// (nombres, roles, estimaciones, descartes) se aprende para las minutas siguientes.

type Side = "todo" | "debo" | "me_deben";
type View = "board" | "list";
type Density = "comfy" | "compact";
// "warning" de `relativeDue` = vence hoy: azul (`due-today`), igual que el color de la card.
const TONE_TEXT = { critical: "text-critical", warning: "text-due-today", muted: "text-muted-foreground" } as const;
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
  initialDensity,
  nowIso,
  suggestions,
  rewrites = [],
  people,
  corrections,
  mailPanels,
  boardOrder,
}: {
  boardOrder?: Record<string, number>;
  rewrites?: RewriteItem[];
  mailPanels: Record<string, FollowupPanelData>;
  initialView: View;
  initialDensity: Density;
  nowIso: string;
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
  const [density, setDensity] = useState<Density>(initialDensity);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // Orden manual del tablero (arrastrar dentro de la columna): ticketId → posición en su grupo.
  const [order, setOrder] = useState<Record<string, number>>(boardOrder ?? {});
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const changeView = (v: View) => {
    setView(v);
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  };
  const changeDensity = (d: Density) => {
    setDensity(d);
    document.cookie = `${DENSITY_COOKIE}=${d}; path=/; max-age=31536000; samesite=lax`;
  };

  const accounts = useMemo(
    () => [...new Map(items.map((i) => [i.clientId, i.clientName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")),
    [items],
  );
  // Movidos a otra columna: se ven en su lugar nuevo al instante, mientras el PATCH y el refresh siguen de fondo.
  // Al llegar datos nuevos del servidor se descartan los ya guardados (los pendientes siguen hasta guardarse).
  const [moved, setMoved] = useState<Record<string, { bucket: Bucket; day: string; saved: boolean }>>({});
  const [itemsSeen, setItemsSeen] = useState(items);
  if (itemsSeen !== items) {
    setItemsSeen(items);
    setMoved((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => !v.saved)));
  }
  const [landedId, setLandedId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const open = items
    .filter((i) => !hidden.has(i.id))
    .map((i) => (moved[i.id] ? movedItem(i, moved[i.id].bucket, moved[i.id].day, now, workDays) : i));
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
      setSelectedId((cur) => (cur === item.id ? null : cur));
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

  // Panel de mail (hilo + borrador) para "Responder" / "Borrador de minuta" / "Reclamar".
  const [mail, setMail] = useState<{ clientId: string; name: string } | null>(null);
  const mailAction = (i: PlannedItem) => {
    if (!isMailItem(i) || !mailPanels[i.clientId]) return undefined;
    return () => setMail({ clientId: i.clientId, name: i.clientName });
  };

  // Hecho / No corresponde esperan CLOSE_DELAY_MS con barra de progreso y "Deshacer" antes de guardarse.
  const [closing, setClosing] = useState<Record<string, Closing>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dropClosing = (id: string) =>
    setClosing((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
  function handle(item: PlannedItem, action: PanelAction) {
    if (action.type !== "done" && action.type !== "remove") return void act(item, action);
    if (timers.current.has(item.id)) return;
    setSelectedId((cur) => (cur === item.id ? null : cur));
    setClosing((c) => ({ ...c, [item.id]: action.type }));
    timers.current.set(
      item.id,
      setTimeout(() => {
        timers.current.delete(item.id);
        dropClosing(item.id);
        void act(item, action);
      }, CLOSE_DELAY_MS),
    );
  }
  function undoClose(id: string) {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    dropClosing(id);
  }

  const dragItem = dragId ? (open.find((i) => i.id === dragId) ?? null) : null;

  // Motion del traspaso (FLIP). Mientras se arrastra, la card real sigue al cursor (overlay `floatRef`, sin la
  // imagen nativa del navegador) y las cards de la columna destino se corren para hacerle lugar a la vista previa.
  // En cada render se guarda la posición de layout (`offsetLeft/Top`, relativa al tablero) de cada card; si cambió
  // durante un arrastre, se anima desde la posición anterior. Al soltar, la card vuela desde el cursor a su lugar
  // (si se suelta fuera de una columna válida, vuelve a la suya). Respeta prefers-reduced-motion.
  const boardRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLUListElement>(null);
  const grabOffset = useRef({ x: 0, y: 0 });
  const [dragGeom, setDragGeom] = useState<{ w: number; x: number; y: number } | null>(null);
  const layoutPos = useRef(new Map<string, { x: number; y: number }>());
  const animateNext = useRef(false);
  const flyFrom = useRef<{ id: string; x: number; y: number } | null>(null);
  const dropped = useRef(false);
  const emptyImg = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    emptyImg.current = img;
  }, []);
  useEffect(() => {
    if (!dragId) return;
    const onOver = (e: DragEvent) => {
      const el = floatRef.current;
      if (!el || (e.clientX === 0 && e.clientY === 0)) return;
      el.style.transform = `translate(${e.clientX - grabOffset.current.x}px, ${e.clientY - grabOffset.current.y}px) rotate(2deg) scale(1.03)`;
    };
    document.addEventListener("dragover", onOver);
    return () => document.removeEventListener("dragover", onOver);
  }, [dragId]);
  function flyFromPointer(id: string, clientX: number, clientY: number) {
    const b = boardRef.current?.getBoundingClientRect();
    if (b) flyFrom.current = { id, x: clientX - grabOffset.current.x - b.left, y: clientY - grabOffset.current.y - b.top };
    animateNext.current = true;
  }
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) {
      layoutPos.current = new Map();
      return;
    }
    const prev = layoutPos.current;
    const next = new Map<string, { x: number; y: number }>();
    const animate =
      (dragId !== null || animateNext.current) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fly = flyFrom.current;
    animateNext.current = false;
    flyFrom.current = null;
    const b = board.getBoundingClientRect();
    const easing = "cubic-bezier(0.2, 0, 0, 1)";
    board.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => {
      const id = el.dataset.cardId!;
      // Oculta (la card de origen mientras se reordena en su columna): conserva su última posición visible.
      if (el.offsetParent === null) {
        const p = prev.get(id);
        if (p) next.set(id, p);
        return;
      }
      const pos = { x: el.offsetLeft, y: el.offsetTop };
      next.set(id, pos);
      if (!animate) return;
      const isFly = fly?.id === id;
      let from: { x: number; y: number };
      if (isFly) from = fly;
      else {
        const p = prev.get(id);
        if (!p) {
          // La vista previa entra con un fade corto.
          if (id.startsWith("ghost:"))
            el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 200, easing });
          return;
        }
        // Si ya se estaba moviendo, parte de donde se ve ahora (no de su layout anterior "puro").
        const r = el.getBoundingClientRect();
        from = { x: p.x + (r.left - b.left - pos.x), y: p.y + (r.top - b.top - pos.y) };
      }
      const dx = from.x - pos.x;
      const dy = from.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.getAnimations().forEach((a) => a.id === "flip" && a.cancel());
      if (isFly) {
        el.style.position = "relative";
        el.style.zIndex = "20";
      }
      const anim = el.animate(
        isFly
          ? [
              { transform: `translate(${dx}px, ${dy}px) rotate(2deg) scale(1.03)`, boxShadow: "var(--shadow-popover)" },
              { transform: "none", boxShadow: "none" },
            ]
          : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { id: "flip", duration: isFly ? 360 : 260, easing },
      );
      if (isFly)
        anim.onfinish = anim.oncancel = () => {
          el.style.position = "";
          el.style.zIndex = "";
        };
    });
    layoutPos.current = next;
  });

  function saveOrder(patch: Record<string, number>) {
    setOrder((o) => ({ ...o, ...patch }));
    void fetch("/api/board-order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: patch, keep: items.map((i) => i.id) }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(() => setMoveError("No se pudo guardar el orden del tablero (queda solo en esta pantalla)."));
  }

  async function moveTo(item: PlannedItem, bucket: Bucket, day: string) {
    setMoved((m) => ({ ...m, [item.id]: { bucket, day, saved: false } }));
    setLandedId(item.id);
    setMoveError(null);
    const ok = await patchClient(item.clientId, { plan: { ticketId: item.id, due: day } });
    if (!ok) {
      setMoved((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
      setMoveError(`No se pudo mover “${item.title}”: volvió a su columna.`);
      return;
    }
    setMoved((m) => (m[item.id] ? { ...m, [item.id]: { ...m[item.id], saved: true } } : m));
    router.refresh();
  }
  const itemProps = (i: PlannedItem): ItemProps => ({
    item: i,
    busy: busy === i.id,
    expanded: expandedId === i.id,
    compact: density === "compact",
    nowMs: now.getTime(),
    workDays,
    onToggle: (id) => setExpandedId((cur) => (cur === id ? null : id)),
    onEdit: setSelectedId,
    onAct: handle,
    closing: closing[i.id],
    onUndo: undoClose,
    onMail: mailAction(i),
  });
  const dragProps = (i: PlannedItem) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", i.id);
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      grabOffset.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (emptyImg.current) e.dataTransfer.setDragImage(emptyImg.current, 0, 0);
      dropped.current = false;
      setDragGeom({ w: r.width, x: r.left, y: r.top });
      setDragId(i.id);
    },
    onDragEnd: (e: React.DragEvent) => {
      // Soltada fuera de una columna válida: vuelve a su lugar desde donde quedó.
      if (!dropped.current && (e.clientX !== 0 || e.clientY !== 0)) flyFromPointer(i.id, e.clientX, e.clientY);
      else animateNext.current = true;
      dropped.current = false;
      setDragId(null);
      setOverCol(null);
      setDropIndex(null);
    },
  });

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
        <RewritesDialog rewrites={rewrites.filter((r) => !account || r.clientId === account)} />
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
            label="Densidad"
            value={density}
            onChange={changeDensity}
            options={[
              ["comfy", <span key="c" title="Cómoda" className="flex"><Rows2 className="size-3.5" /></span>],
              ["compact", <span key="k" title="Compacta" className="flex"><Rows4 className="size-3.5" /></span>],
            ]}
          />
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
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm border border-critical/50 bg-critical/10" /> Muy atrasado (≥2 días háb.)
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm border border-overdue/50 bg-overdue/10" /> Vencido (1 día)
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm border border-due-today/50 bg-due-today/10" /> Vence hoy
        </span>
        <span>· Click para desplegar{view === "board" ? "; arrastrá la card a otra columna para cambiarle la fecha" : ""}.</span>
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

      {moveError && (
        <p role="alert" className="rounded-md border border-critical/25 bg-critical-muted px-3 py-1.5 text-xs text-critical">
          {moveError}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No hay accionables con estos filtros.
        </p>
      ) : view === "board" ? (
        <div ref={boardRef} className="relative grid items-start gap-3 md:grid-cols-2 xl:grid-cols-5">
          {dragItem && dragGeom && (
            <ul
              ref={floatRef}
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 z-50 origin-top-left rounded-lg bg-card"
              style={{ width: dragGeom.w, transform: `translate(${dragGeom.x}px, ${dragGeom.y}px) rotate(2deg) scale(1.03)` }}
            >
              <ItemCard
                item={dragItem}
                busy={false}
                expanded={false}
                compact={density === "compact"}
                nowMs={now.getTime()}
                workDays={workDays}
                onToggle={noop}
                onEdit={noop}
                onAct={noop}
                onUndo={noop}
                drag={NO_DRAG}
                dragging={false}
                floating
              />
            </ul>
          )}
          {COLUMNS.map((col) => {
            // Misma columna = reordenar; otra columna = cambiar la fecha (y quedar en la posición donde se suelta).
            const own = dragItem?.bucket === col.key;
            const target = dragItem && !own ? dropDue(col.key, now, workDays) : null;
            const accepts = !!dragItem && (own || !!target);
            const isOver = accepts && overCol === col.key;
            // Vista previa: mientras se arrastra encima, la card aparece (punteada) donde va a quedar.
            const preview = isOver && dragItem ? (own ? { ...dragItem } : movedItem(dragItem, col.key, target!, now, workDays)) : null;
            const base = visible.filter((i) => i.bucket === col.key);
            const insert = preview && dropIndex !== null ? insertAt(base, preview, dropIndex, order) : null;
            const colOrder = insert ? { ...order, ...insert } : order;
            const list = preview ? base.concat([preview]) : base;
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  if (!accepts || !dragItem) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overCol !== col.key) setOverCol(col.key);
                  const idx = dropSlot(e.currentTarget, e.clientY, groupOf(dragItem), dragItem.id);
                  if (idx !== dropIndex) setDropIndex(idx);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol((c) => (c === col.key ? null : c));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const item = dragItem;
                  setOverCol(null);
                  setDropIndex(null);
                  setDragId(null);
                  if (!item || !accepts) return;
                  dropped.current = true;
                  flyFromPointer(item.id, e.clientX, e.clientY);
                  if (insert) saveOrder(insert);
                  if (target) void moveTo(item, col.key, target);
                }}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-2 transition-colors",
                  dragItem && !accepts && "opacity-60",
                  isOver && target && "border-ring bg-accent/60",
                )}
              >
                <ColumnHeader label={col.label} tone={col.tone} items={own ? base : list} />
                {isOver && target && (
                  <p className="rounded-md border border-dashed border-ring px-2 py-1.5 text-center text-label-sm text-foreground">
                    Soltar → entrega {fmtShortDate(`${target}T12:00:00`)}
                  </p>
                )}
                {list.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-subtle-foreground">Nada acá</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    <Grouped
                      items={list}
                      order={colOrder}
                      render={(i) => (
                        <ItemCard
                          key={i === preview ? "ghost" : i.id}
                          {...itemProps(i)}
                          drag={dragProps(i)}
                          dragging={dragId === i.id && i !== preview}
                          collapsed={own && !!preview && dragId === i.id && i !== preview}
                          ghost={i === preview}
                          landed={landedId === i.id}
                          onLanded={() => setLandedId((cur) => (cur === i.id ? null : cur))}
                        />
                      )}
                    />
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
                  <Grouped items={list} order={order} render={(i) => <ItemRow key={i.id} {...itemProps(i)} />} />
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {mail && (
        <FollowupPanel
          key={mail.clientId}
          alert={{ clientId: mail.clientId, name: mail.name }}
          data={mailPanels[mail.clientId]}
          open
          onOpenChange={(o) => !o && setMail(null)}
        />
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
        onAction={handle}
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

type ItemProps = {
  item: PlannedItem;
  busy: boolean;
  expanded: boolean;
  compact: boolean;
  nowMs: number;
  workDays: number[];
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onAct: (item: PlannedItem, action: PanelAction) => void;
  /** Cierre en curso (hecho / quitar) esperando el "Deshacer". */
  closing?: Closing;
  onUndo: (id: string) => void;
  /** Abre el panel de mail (hilo + borrador) si el accionable se resuelve con un mail. */
  onMail?: () => void;
};
type Closing = "done" | "remove";
type DragProps = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
};
const noop = () => {};

/** Posición (dentro de su grupo) donde caería la card según el cursor: cuántas cards del grupo quedan arriba. */
function dropSlot(section: HTMLElement, clientY: number, group: BoardGroup, dragId: string): number {
  let n = 0;
  section.querySelectorAll<HTMLElement>(`[data-card-id][data-group="${group}"]`).forEach((el) => {
    const id = el.dataset.cardId!;
    if (id === dragId || id.startsWith("ghost:")) return;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && clientY > r.top + r.height / 2) n++;
  });
  return n;
}

/** Orden del grupo de `item` en la columna con `item` en la posición `index` (todo el grupo pasa a orden manual). */
function insertAt(base: PlannedItem[], item: PlannedItem, index: number, order: Record<string, number>): Record<string, number> {
  const seq = boardGroups(base.filter((i) => i.id !== item.id), order)[groupOf(item)];
  seq.splice(Math.min(index, seq.length), 0, item);
  return Object.fromEntries(seq.map((i, k) => [i.id, k]));
}
const NO_DRAG: DragProps = { draggable: false, onDragStart: noop, onDragEnd: noop };

/** Atención → Arrastrados → Nuevos (`boardGroups`), con subtítulo cuando conviven 2 o más grupos. */
function Grouped({
  items,
  order,
  render,
}: {
  items: PlannedItem[];
  order?: Record<string, number>;
  render: (i: PlannedItem) => React.ReactNode;
}) {
  const { attention, carried, fresh } = boardGroups(items, order);
  const split = [attention, carried, fresh].filter((g) => g.length > 0).length > 1;
  const label = (text: string, n: number, tone: "attention" | "carried" | "muted") => (
    <li
      role="presentation"
      className={cn(
        "flex items-center gap-2 px-1 pt-1 text-label-sm uppercase",
        tone === "attention" ? "text-warning" : tone === "carried" ? "text-carried" : "text-subtle-foreground",
      )}
    >
      {text} <span className="tabular">{n}</span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
  return (
    <>
      {split && attention.length > 0 && label("Atención", attention.length, "attention")}
      {attention.map(render)}
      {split && carried.length > 0 && label("Arrastrados", carried.length, "carried")}
      {carried.map(render)}
      {split && fresh.length > 0 && label("Nuevos", fresh.length, "muted")}
      {fresh.map(render)}
    </>
  );
}

function DoneBox({ item, busy, onAct, closing, onUndo }: Pick<ItemProps, "item" | "busy" | "onAct" | "closing" | "onUndo">) {
  return (
    <span onClick={(e) => e.stopPropagation()} className="flex">
      <Checkbox
        aria-label="Marcar hecho"
        disabled={busy || closing === "remove"}
        checked={closing === "done"}
        onCheckedChange={(v) => (v ? onAct(item, { type: "done" }) : onUndo(item.id))}
      />
    </span>
  );
}

function DueLine({ item }: { item: PlannedItem }) {
  const rel = relativeDue(item);
  const Icon = DUE_ICON[item.dueKind];
  return (
    <span className={cn("flex shrink-0 items-center gap-1 font-medium", TONE_TEXT[rel.tone])} title={`${DUE_HINT[item.dueKind]} · ${item.dueLabel}`}>
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

/** Chip violeta de los arrastrados: cuánto hace que vienen de la minuta/mail de origen. */
function CarriedChip({ item, nowMs, iconOnly }: { item: PlannedItem; nowMs: number; iconOnly?: boolean }) {
  if (!item.carried) return null;
  const age = carriedAge(item.originDate, nowMs);
  return (
    <span
      title={`Arrastrado desde ${fmtShortDate(item.originDate)} (${age})`}
      className="inline-flex shrink-0 items-center gap-1 rounded bg-carried/15 px-1.5 py-px text-label-sm font-medium text-carried"
    >
      <History className="size-3" />
      {!iconOnly && age}
    </span>
  );
}

const toggleKeys = (onToggle: () => void) => (e: React.KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onToggle();
  }
};

/** Lo que aparece al desplegar: texto completo, origen, responsables, plazo y acciones rápidas. */
function Expanded({ item, busy, workDays, onAct, onEdit, closing, onMail }: ItemProps) {
  // Posponer desde la fecha actual o desde hoy, lo que sea más tarde (igual que el modal).
  const postpone = () => {
    const base = new Date(Math.max(Date.now(), Date.parse(item.due)));
    onAct(item, { type: "due", due: isoDay(addWorkdays(base, 1, workDays)) });
  };
  const account = `/cuentas/${encodeURIComponent(item.clientId)}`;
  return (
    <div className="space-y-2 border-t border-border px-2.5 pt-1.5 pb-2" onClick={(e) => e.stopPropagation()}>
      {item.fullText !== item.title && !(item.detail && item.fullText.includes(item.detail)) && (
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground 2xl:text-sm">{item.fullText}</p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-subtle-foreground">Origen</dt>
        <dd className="truncate text-muted-foreground" title={item.originTitle}>
          {originLabel(item)} · {item.originTitle}
        </dd>
        {item.owners.length > 0 && (
          <>
            <dt className="text-subtle-foreground">Resp.</dt>
            <dd className="text-muted-foreground">{item.owners.join(", ")}</dd>
          </>
        )}
        <dt className="text-subtle-foreground">Entrega</dt>
        <dd className="text-muted-foreground">
          {DUE_KIND[item.dueKind]} · <span className="tabular">{item.dueLabel}</span> · {fmtMinutes(item.estimateMinutes)}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={busy || !!closing} onClick={() => onAct(item, { type: "done" })}>
          <Check /> Hecho
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={postpone}>
          <CalendarClock /> +1 día
        </Button>
        {item.side === "me_deben" && !onMail && (
          <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`${account}?borrador=status`} />}>
            <Mail /> Reclamar
          </Button>
        )}
        <Button size="xs" variant="ghost" nativeButton={false} render={<Link href={account} />}>
          Cuenta <ArrowUpRight />
        </Button>
        <MailButton item={item} onMail={onMail} />
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onEdit(item.id)}>
          <Pencil /> Editar
        </Button>
        {item.removable && (
          <Button
            size="xs"
            variant="ghost"
            className="text-critical hover:text-critical"
            disabled={busy || !!closing}
            title="No corresponde / ya no aplica: lo quita de la cuenta"
            onClick={() => onAct(item, { type: "remove" })}
          >
            <Trash2 /> Quitar
          </Button>
        )}
      </div>
    </div>
  );
}

/** Fondo/borde según `cardTone`: rojo claro (muy atrasado), ámbar (hoy), violeta (arrastrado reciente) o neutro. */
// La card se pinta entera (fondo + todo el borde) según el plazo: rojo muy atrasado, naranja vencido, amarillo hoy,
// gris nuevo / en plazo. Sin franja de prioridad, para que ningún borde contradiga el color de la card.
const TONE_CARD: Record<NonNullable<CardTone> | "none", string> = {
  late: "border-critical/50 bg-critical/10",
  overdue: "border-overdue/50 bg-overdue/10",
  today: "border-due-today/50 bg-due-today/10",
  none: "border-border bg-card",
};
const TONE_ROW: Record<NonNullable<CardTone> | "none", string> = {
  late: "border-l-critical bg-critical/10",
  overdue: "border-l-overdue bg-overdue/10",
  today: "border-l-due-today bg-due-today/10",
  none: "border-l-transparent",
};

function Chevron({ expanded }: { expanded: boolean }) {
  return <ChevronDown className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", expanded && "rotate-180")} />;
}

function ItemCard(
  props: ItemProps & {
    drag: DragProps;
    dragging: boolean;
    ghost?: boolean;
    floating?: boolean;
    collapsed?: boolean;
    landed?: boolean;
    onLanded?: () => void;
  },
) {
  const { item, busy, expanded, compact, nowMs, onToggle, drag, dragging, ghost, floating, collapsed, landed } = props;
  const OriginIcon = item.originKind === "mail" ? Mail : Users;
  const toggle = () => onToggle(item.id);
  const tone = cardTone(item) ?? "none";
  return (
    <li
      {...(ghost || floating ? {} : drag)}
      aria-hidden={ghost || floating || undefined}
      data-card-id={floating ? undefined : ghost ? `ghost:${item.bucket}` : item.id}
      data-group={groupOf(item)}
      onAnimationEnd={landed ? props.onLanded : undefined}
      className={cn(
        "rounded-lg border border-l-2 transition-[opacity,transform,border-color,background-color] duration-150",
        TONE_CARD[tone],
        expanded ? "shadow-highlight" : "hover:border-border-strong",
        busy && "opacity-60",
        dragging && "scale-[0.98] border-dashed opacity-30",
        floating && "shadow-popover",
        collapsed && "hidden",
        ghost && "pointer-events-none border-dashed border-ring opacity-60",
        landed && "motion-safe:animate-card-landed",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={toggleKeys(toggle)}
        className={cn(
          "flex cursor-pointer flex-col rounded-lg text-left outline-none focus-visible:ring-1 focus-visible:ring-ring",
          props.closing && "opacity-50 [&_p]:line-through",
          compact ? "gap-0.5 px-2.5 py-1.5" : "gap-1 px-3 py-2",
        )}
      >
        {/* Cliente + arrastrado + hecho */}
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground 2xl:text-[12.5px]"
            title={item.erp ? `${item.clientName} · ${item.erp}` : item.clientName}
          >
            {item.clientName}
          </span>
          {item.attention && <AttentionBadge size="sm" />}
          {item.aiAdded && <AiChip evidence={item.evidence} />}
          <CarriedChip item={item} nowMs={nowMs} iconOnly={compact} />
          <DoneBox item={item} busy={busy} onAct={props.onAct} closing={props.closing} onUndo={props.onUndo} />
        </div>
        {/* Hito + tarea */}
        <p className={cn("leading-snug font-medium text-foreground-strong", compact ? "text-[11.5px] 2xl:text-[12.5px]" : "text-[12.5px] 2xl:text-[13.5px]", !expanded && (compact ? "truncate" : "line-clamp-2"))}>
          {item.title}
        </p>
        {item.detail && (
          <p className={cn("leading-snug text-muted-foreground", compact ? "text-[11.5px] 2xl:text-[12.5px]" : "text-[12.5px] 2xl:text-[13.5px]", !expanded && (compact ? "line-clamp-1" : "line-clamp-3"))}>{item.detail}</p>
        )}
        {/* Plazo · estimación · origen | lado */}
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]", compact ? "mt-0" : "mt-0.5")}>
          <DueLine item={item} />
          {!compact && <span className="tabular text-muted-foreground">{fmtMinutes(item.estimateMinutes)}</span>}
          {!compact && (
            <span className="flex items-center gap-1 text-subtle-foreground">
              <OriginIcon className="size-3" />
              <span className="tabular">{fmtShortDate(item.originDate)}</span>
            </span>
          )}
          {item.atRisk && (
            <span title="Sin espacio en la agenda" className="flex">
              <StatusDot tone="critical" />
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {!compact && <SideLine item={item} />}
            <Chevron expanded={expanded} />
          </span>
        </div>
      </div>
      {expanded && !props.closing && <Expanded {...props} />}
      {props.closing && <ClosingBar kind={props.closing} onUndo={() => props.onUndo(item.id)} />}
    </li>
  );
}

function ItemRow(props: ItemProps) {
  const { item, busy, expanded, compact, nowMs, onToggle } = props;
  const toggle = () => onToggle(item.id);
  const tone = cardTone(item) ?? "none";
  return (
    <li className={cn("border-l-2", TONE_ROW[tone], busy && "opacity-60")}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={toggleKeys(toggle)}
        className={cn(
          "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-3 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 md:grid-cols-[auto_minmax(0,1fr)_150px_70px_170px]",
          compact ? "py-1.5" : "py-2.5",
          props.closing && "opacity-50",
        )}
      >
        <DoneBox item={item} busy={busy} onAct={props.onAct} closing={props.closing} onUndo={props.onUndo} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="max-w-56 shrink-0 truncate text-xs font-semibold text-foreground 2xl:text-[13px]">{item.clientName}</span>
            {item.attention && <AttentionBadge size="sm" />}
            {item.aiAdded && <AiChip evidence={item.evidence} />}
            <CarriedChip item={item} nowMs={nowMs} iconOnly={compact} />
          </span>
          <span className={cn("block text-[13px] font-medium text-foreground-strong 2xl:text-sm", !expanded && "truncate")}>{item.title}</span>
          {item.detail && (
            <span className={cn("block text-[13px] text-muted-foreground 2xl:text-sm", !expanded && (compact ? "truncate" : "line-clamp-2"))}>{item.detail}</span>
          )}
        </span>
        <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] md:contents">
          <DueLine item={item} />
          <span className="tabular text-muted-foreground">{fmtMinutes(item.estimateMinutes)}</span>
          <span className="flex items-center gap-1.5 md:justify-end">
            {item.atRisk && (
              <span title="Sin espacio en la agenda" className="flex">
                <StatusDot tone="critical" />
              </span>
            )}
            <SideLine item={item} />
            <Chevron expanded={expanded} />
          </span>
        </span>
      </div>
      {expanded && !props.closing && <Expanded {...props} />}
      {props.closing && <ClosingBar kind={props.closing} onUndo={() => props.onUndo(item.id)} />}
    </li>
  );
}

/** Barra de cierre: se vacía en CLOSE_DELAY_MS y recién ahí se guarda; "Deshacer" lo cancela. */
function ClosingBar({ kind, onUndo }: { kind: Closing; onUndo: () => void }) {
  return (
    <div className="space-y-1.5 border-t border-border px-3 pt-2 pb-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("flex items-center gap-1.5 font-medium", kind === "done" ? "text-success" : "text-critical")}>
          {kind === "done" ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
          {kind === "done" ? "Marcando como hecho…" : "Quitando accionable…"}
        </span>
        <Button size="xs" variant="outline" onClick={onUndo}>
          <Undo2 /> Deshacer
        </Button>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-accent">
        <div
          className={cn("h-full origin-left rounded-full", kind === "done" ? "bg-success" : "bg-critical")}
          style={{ animation: `closing-bar ${CLOSE_DELAY_MS}ms linear forwards` }}
        />
      </div>
    </div>
  );
}

/** Ícono chico junto a "Cuenta" en la card desplegada: abre el panel de mail (Responder / minuta / Reclamar). */
function MailButton({ item, onMail }: { item: PlannedItem; onMail?: () => void }) {
  if (!onMail) return null;
  const label = MAIL_ACTION_LABEL(item);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onMail();
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Send className="size-3.5" />
    </button>
  );
}

/** Lo sumó el análisis semanal con IA (detectado en mails o la minuta y que faltaba en el tablero). */
function AiChip({ evidence }: { evidence?: string }) {
  return (
    <span
      title={`Agregado por el análisis IA${evidence ? ` · ${evidence}` : ""}`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-border px-1 text-[10.5px] font-medium text-muted-foreground"
    >
      <Sparkles className="size-2.5" /> IA
    </span>
  );
}
