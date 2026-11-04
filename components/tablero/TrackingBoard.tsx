"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { TrackingColumn, PLACEHOLDER_KEY } from "@/components/tablero/TrackingColumn";
import { TrackingCardFace, type TrackingCardData } from "@/components/tablero/TrackingCard";
import { ArchiveDialog, TrackingDialog } from "@/components/tablero/TrackingDialog";
import { TRACKING_COLUMNS } from "@/lib/tracking";
import { isSameDay, resolveCardStatus, weekStart, type BoardCard } from "@/lib/utils/board-status";
import type { TrackingStatus } from "@/types/account";
import type { Ticket } from "@/types/ticket";

// Drag-and-drop propio con pointer events (sin HTML5 DnD: su "ghost" nativo es el que
// arrastraba parte de la pantalla). Overlay flotante que sigue al puntero con inclinación
// según velocidad, placeholder que abre hueco en la columna destino y FLIP (Web Animations)
// para que el resto de las cards se reacomode con motion. El orden dentro de la columna
// es local. Cada card (una por reunión o mail) se ubica sola según sus tildes; moverla a mano
// persiste vía PATCH /api/clients/[id] y vale hasta el próximo tildado.

type Slot = { status: TrackingStatus; index: number };

interface DragState {
  id: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  origin: Slot;
  over: Slot;
}

interface Pending {
  id: string;
  el: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  touch: boolean;
  timer: number | null;
  armed: boolean;
}

const DRAG_THRESHOLD = 5;
const TOUCH_HOLD_MS = 220;
const EDGE = 80;
const EASE = "cubic-bezier(0.2, 0.9, 0.25, 1)";
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

type Period = "all" | "today" | "week";
const PERIODS: { value: Period; label: string; hint: string }[] = [
  { value: "all", label: "Todas", hint: "Todas las cards" },
  { value: "today", label: "Hoy", hint: "Prioridad, más lo generado o trabajado hoy" },
  { value: "week", label: "Esta semana", hint: "Reuniones y mails de esta semana" },
];

type BoardItem = { id: string; trackingStatus: TrackingStatus; data: TrackingCardData };

export function TrackingBoard({
  heading,
  cards,
  tickets: initialTickets,
  initialOpenId = null,
  nowIso,
}: {
  heading: React.ReactNode;
  cards: BoardCard[];
  tickets: Ticket[];
  initialOpenId?: string | null;
  nowIso: string;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const monday = useMemo(() => weekStart(now), [now]);
  const [order, setOrder] = useState(() => cards.map((c) => c.id));
  // Cambios de esta sesión sobre lo que trajo el servidor (null = sin ubicación manual).
  const [overrides, setOverrides] = useState<Record<string, BoardCard["override"]>>({});
  const [toggles, setToggles] = useState<Record<string, { isDone: boolean; at: string | null }>>({});
  const [query, setQuery] = useState("");
  const q = norm(query.trim());
  const [period, setPeriod] = useState<Period>("all");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    initialOpenId && cards.some((c) => c.id === initialOpenId) ? initialOpenId : null,
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(initialOpenId);

  const tickets = useMemo(
    () =>
      initialTickets.map((t) => {
        const local = toggles[t.id];
        return local ? { ...t, isDone: local.isDone, doneAt: local.at } : t;
      }),
    [initialTickets, toggles],
  );

  const cardData = useMemo(() => {
    const map = new Map<string, TrackingCardData>();
    for (const card of cards) {
      const own = tickets.filter((t) => t.cardId === card.id);
      const done = own.filter((t) => t.isDone).length;
      const override = card.id in overrides ? overrides[card.id] : card.override;
      // Tildar es interacción: la card sale de Prioridad en el momento.
      const priorityReason = own.some((t) => toggles[t.id]?.isDone) ? null : card.priorityReason;
      const status = resolveCardStatus({ override }, priorityReason, own.length, done);
      const lastTick = own.map((t) => t.doneAt).filter((x): x is string => !!x).sort().at(-1);
      map.set(card.id, {
        card,
        status,
        tickets: own,
        done,
        total: own.length,
        percent: own.length ? Math.round((done / own.length) * 100) : 0,
        closedAt: status === "tasks_done" ? (override?.at ?? lastTick ?? card.date) : null,
        priorityReason,
      });
    }
    return map;
  }, [cards, tickets, overrides, toggles]);

  // Las cards nuevas (reunión o mail recién llegados) entran primero.
  const allIds = useMemo(() => {
    const known = new Set(order);
    return [...cards.filter((c) => !known.has(c.id)).map((c) => c.id), ...order.filter((id) => cardData.has(id))];
  }, [cards, order, cardData]);
  const isArchived = useCallback(
    (d: TrackingCardData) => d.status === "tasks_done" && !!d.closedAt && new Date(d.closedAt) < monday,
    [monday],
  );
  const items = useMemo<BoardItem[]>(() => {
    const visible = allIds.map((id) => cardData.get(id)!).filter((d) => !isArchived(d));
    // Finalizadas: lo último que cerraste, arriba.
    const closed = visible
      .filter((d) => d.status === "tasks_done")
      .sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? ""));
    return [...visible.filter((d) => d.status !== "tasks_done"), ...closed].map((data) => ({
      id: data.card.id,
      trackingStatus: data.status,
      data,
    }));
  }, [allIds, cardData, isArchived]);
  const archived = useMemo(() => [...cardData.values()].filter(isArchived), [cardData, isArchived]);

  const matches = useCallback(
    ({ data }: BoardItem) => {
      const { card, status, tickets: own, closedAt } = data;
      if (q && !norm(`${card.accountName} ${card.title}`).includes(q)) return false;
      const date = new Date(card.date);
      if (period === "week") return date >= monday;
      if (period === "today") {
        return (
          status === "tasks_priority" ||
          isSameDay(date, now) ||
          (!!closedAt && isSameDay(new Date(closedAt), now)) ||
          own.some((t) => t.doneAt && isSameDay(new Date(t.doneAt), now))
        );
      }
      return true;
    },
    [q, period, monday, now],
  );

  // ---- refs ----
  const scrollerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listEls = useRef(new Map<TrackingStatus, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const prevRects = useRef<Map<string, DOMRect> | null>(null);
  const landedId = useRef<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointer = useRef({ x: 0, y: 0, lastX: 0, tilt: 0, targetTilt: 0 });
  const raf = useRef<number | null>(null);
  const dropping = useRef(false);
  const suppressClick = useRef(false);
  const itemsRef = useRef(items);
  const matchesRef = useRef(matches);
  const allIdsRef = useRef(allIds);
  useLayoutEffect(() => {
    itemsRef.current = items;
    matchesRef.current = matches;
    allIdsRef.current = allIds;
  }, [items, matches, allIds]);

  const updateDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const registerList = useCallback((status: TrackingStatus, el: HTMLElement | null) => {
    if (el) listEls.current.set(status, el);
    else listEls.current.delete(status);
  }, []);
  const registerCard = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);

  // ---- FLIP ----
  const captureRects = useCallback(() => {
    const map = new Map<string, DOMRect>();
    for (const [id, el] of cardEls.current) map.set(id, el.getBoundingClientRect());
    prevRects.current = map;
  }, []);

  useLayoutEffect(() => {
    const prev = prevRects.current;
    prevRects.current = null;
    const motion = !reducedMotion();
    if (prev && motion) {
      for (const [id, el] of cardEls.current) {
        const before = prev.get(id);
        if (!before) continue;
        el.getAnimations().forEach((a) => a.cancel());
        const after = el.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
          duration: 260,
          easing: EASE,
        });
      }
    }
    const landed = landedId.current;
    landedId.current = null;
    const el = landed ? cardEls.current.get(landed) : null;
    if (el && motion) {
      el.animate(
        [
          { transform: "scale(1.04)", filter: "brightness(1.04)" },
          { transform: "scale(0.985)", offset: 0.6 },
          { transform: "scale(1)", filter: "brightness(1)" },
        ],
        { duration: 380, easing: EASE },
      );
    }
  });

  // Posición inicial del overlay antes del primer paint (luego la maneja `tick`).
  const dragId = drag?.id;
  useLayoutEffect(() => {
    const d = dragRef.current;
    const overlay = overlayRef.current;
    if (!d || !overlay) return;
    const p = pointer.current;
    overlay.style.transform = `translate3d(${p.x - d.offsetX}px, ${p.y - d.offsetY}px, 0) scale(1.04)`;
    if (!reducedMotion()) {
      overlay.animate([{ transform: `translate3d(${p.x - d.offsetX}px, ${p.y - d.offsetY}px, 0) scale(1)` }, { transform: overlay.style.transform }], {
        duration: 160,
        easing: EASE,
      });
    }
  }, [dragId]);

  // ---- deep link ?open=<id> ----
  useEffect(() => {
    if (!initialOpenId) return;
    cardEls.current.get(initialOpenId)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const t = window.setTimeout(() => setHighlightedId(null), 2400);
    return () => window.clearTimeout(t);
  }, [initialOpenId]);

  // ---- hit testing ----
  const columnCards = useCallback(
    (status: TrackingStatus, excludeId: string) =>
      itemsRef.current.filter((a) => a.trackingStatus === status && a.id !== excludeId && matchesRef.current(a)),
    [],
  );

  const computeSlot = useCallback(
    (x: number, y: number, d: DragState): Slot => {
      const scroller = scrollerRef.current?.getBoundingClientRect();
      if (scroller && (y < scroller.top - 120 || y > window.innerHeight + 40)) return d.origin;

      let best: { status: TrackingStatus; dist: number; rect: DOMRect } | null = null;
      for (const { status } of TRACKING_COLUMNS) {
        const list = listEls.current.get(status);
        const col = list?.parentElement;
        if (!col) continue;
        const rect = col.getBoundingClientRect();
        const dist = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        if (!best || dist < best.dist) best = { status, dist, rect };
      }
      if (!best || best.dist > 160) return d.origin;

      const cards = columnCards(best.status, d.id);
      let index = 0;
      for (const a of cards) {
        const el = cardEls.current.get(a.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top + r.height / 2 < y) index++;
      }
      return { status: best.status, index };
    },
    [columnCards],
  );

  const tickRef = useRef<() => void>(() => {});

  // ---- render loop: overlay + tilt + autoscroll + slot ----
  const tick = useCallback(() => {
    raf.current = null;
    const d = dragRef.current;
    const p = pointer.current;
    if (!d || dropping.current) return;

    p.targetTilt *= 0.86;
    p.tilt += (p.targetTilt - p.tilt) * 0.22;
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.transform = `translate3d(${p.x - d.offsetX}px, ${p.y - d.offsetY}px, 0) rotate(${p.tilt.toFixed(2)}deg) scale(1.04)`;
    }

    const scroller = scrollerRef.current;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (p.x < r.left + EDGE) scroller.scrollLeft -= Math.ceil(((r.left + EDGE - p.x) / EDGE) * 18);
      else if (p.x > r.right - EDGE) scroller.scrollLeft += Math.ceil(((p.x - (r.right - EDGE)) / EDGE) * 18);
    }
    // En escritorio cada columna tiene su scroll: si la lista es larga, se mueve al llegar al borde.
    const list = listEls.current.get(d.over.status);
    if (list) {
      const r = list.getBoundingClientRect();
      if (p.y < r.top + 48) list.scrollTop -= 10;
      else if (p.y > r.bottom - 48) list.scrollTop += 10;
    }
    if (p.y < EDGE) window.scrollBy(0, -Math.ceil(((EDGE - p.y) / EDGE) * 16));
    else if (p.y > window.innerHeight - EDGE) window.scrollBy(0, Math.ceil(((p.y - (window.innerHeight - EDGE)) / EDGE) * 16));

    const slot = computeSlot(p.x, p.y, d);
    if (slot.status !== d.over.status || slot.index !== d.over.index) {
      captureRects();
      updateDrag({ ...d, over: slot });
    }

    // Loop continuo mientras dura el drag (tilt con inercia + autoscroll).
    raf.current = requestAnimationFrame(() => tickRef.current());
  }, [captureRects, computeSlot, updateDrag]);

  useLayoutEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const schedule = useCallback(() => {
    if (raf.current == null) raf.current = requestAnimationFrame(() => tickRef.current());
  }, []);

  const activate = useCallback(() => {
    const pd = pending.current;
    if (!pd) return;
    const item = itemsRef.current.find((a) => a.id === pd.id);
    if (!item) return;
    const rect = pd.el.getBoundingClientRect();
    const index = columnCards(item.trackingStatus, pd.id).filter(
      (a) => itemsRef.current.indexOf(a) < itemsRef.current.indexOf(item),
    ).length;
    const origin = { status: item.trackingStatus, index };
    const p = pointer.current;
    p.tilt = 0;
    p.targetTilt = 0;
    p.lastX = p.x;
    suppressClick.current = true;
    pending.current = null;
    captureRects();
    updateDrag({
      id: pd.id,
      width: rect.width,
      height: rect.height,
      offsetX: pd.startX - rect.left,
      offsetY: pd.startY - rect.top,
      origin,
      over: origin,
    });
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    navigator.vibrate?.(8);
    schedule();
  }, [captureRects, columnCards, schedule, updateDrag]);

  const persistMove = useCallback((card: BoardCard, status: TrackingStatus) => {
    setOverrides((prev) => ({ ...prev, [card.id]: { status, at: new Date().toISOString() } }));
    void fetch(`/api/clients/${encodeURIComponent(card.accountId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardCard: { id: card.id, status } }),
    });
  }, []);

  const finish = useCallback(
    (cancel: boolean) => {
      const d = dragRef.current;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (!d) return;
      dropping.current = true;
      const target = cancel ? d.origin : d.over;

      const commit = () => {
        dropping.current = false;
        captureRects();
        landedId.current = d.id;
        const moving = itemsRef.current.find((a) => a.id === d.id);
        if (moving) {
          const rest = itemsRef.current.filter((a) => a.id !== d.id);
          // target.index cuenta solo las cards visibles: con filtro activo, las ocultas no ocupan posición.
          const inCol = rest.filter((a) => a.trackingStatus === target.status && matchesRef.current(a));
          const before = inCol[target.index];
          if (before) rest.splice(rest.indexOf(before), 0, moving);
          else if (inCol.length) rest.splice(rest.indexOf(inCol[inCol.length - 1]) + 1, 0, moving);
          else rest.push(moving);
          const placed = rest.map((a) => a.id);
          const others = allIdsRef.current.filter((id) => !placed.includes(id));
          setOrder([...placed, ...others]);
          if (target.status !== d.origin.status) persistMove(moving.data.card, target.status);
        }
        updateDrag(null);
      };

      if (cancel && (target.status !== d.over.status || target.index !== d.over.index)) {
        captureRects();
        updateDrag({ ...d, over: target });
      }

      // Vuela el overlay hasta el hueco y recién ahí materializa la card.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const overlay = overlayRef.current;
        const slot = cardEls.current.get(PLACEHOLDER_KEY)?.getBoundingClientRect();
        if (!overlay || !slot || reducedMotion()) return commit();
        const from = overlay.style.transform;
        overlay.style.transform = `translate3d(${slot.left}px, ${slot.top}px, 0) rotate(0deg) scale(1)`;
        const anim = overlay.animate(
          [{ transform: from }, { transform: overlay.style.transform }],
          { duration: 240, easing: EASE },
        );
        anim.onfinish = commit;
        anim.oncancel = commit;
      }));
    },
    [captureRects, persistMove, updateDrag],
  );

  // ---- global pointer listeners ----
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const p = pointer.current;
      p.x = e.clientX;
      p.y = e.clientY;
      const pd = pending.current;
      if (pd && e.pointerId === pd.pointerId) {
        const dist = Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY);
        if (pd.touch) {
          if (!pd.armed && dist > 8) {
            if (pd.timer) window.clearTimeout(pd.timer);
            pending.current = null; // el usuario está scrolleando
          } else if (pd.armed) activate();
        } else if (dist > DRAG_THRESHOLD) activate();
        return;
      }
      if (dragRef.current && !dropping.current) {
        p.targetTilt = clamp(p.targetTilt + (e.clientX - p.lastX) * 0.35, -9, 9);
        p.lastX = e.clientX;
      }
    }
    function onUp() {
      const pd = pending.current;
      if (pd?.timer) window.clearTimeout(pd.timer);
      pending.current = null;
      if (dragRef.current && !dropping.current) finish(false);
      window.setTimeout(() => (suppressClick.current = false), 0);
    }
    function onCancel() {
      pending.current = null;
      if (dragRef.current && !dropping.current) finish(true);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current && !dropping.current) finish(true);
    }
    function onTouchMove(e: TouchEvent) {
      if (dragRef.current || pending.current?.armed) e.preventDefault();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", onTouchMove);
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [activate, finish]);

  const onCardPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0 || dragRef.current) return;
      const touch = e.pointerType === "touch";
      pointer.current.x = e.clientX;
      pointer.current.y = e.clientY;
      const pd: Pending = {
        id,
        el: e.currentTarget,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        touch,
        timer: null,
        armed: !touch,
      };
      if (touch) {
        pd.timer = window.setTimeout(() => {
          if (pending.current !== pd) return;
          pd.armed = true;
          activate();
        }, TOUCH_HOLD_MS);
      }
      pending.current = pd;
    },
    [activate],
  );

  const onOpen = useCallback((id: string) => {
    if (suppressClick.current) return;
    setOpenId(id);
  }, []);

  function moveTo(id: string, status: TrackingStatus) {
    const data = cardData.get(id);
    if (!data || data.status === status) return;
    captureRects();
    landedId.current = id;
    setOrder((prev) => [...prev.filter((x) => x !== id), id]);
    persistMove(data.card, status);
  }

  /** Estado local al tildar: la card pasa sola a En curso, y a Finalizadas con el último punto. */
  const toggleTicket = useCallback(
    (ticketId: string, isDone: boolean) => {
      captureRects();
      const cardId = initialTickets.find((t) => t.id === ticketId)?.cardId;
      setToggles((prev) => ({ ...prev, [ticketId]: { isDone, at: isDone ? new Date().toISOString() : null } }));
      if (cardId) setOverrides((prev) => ({ ...prev, [cardId]: null }));
    },
    [captureRects, initialTickets],
  );

  /** Tildado desde la cara de la card (en el Dialog lo guarda TicketItem). */
  const toggleFromCard = useCallback(
    (ticket: Ticket, isDone: boolean) => {
      toggleTicket(ticket.id, isDone);
      void fetch(`/api/clients/${encodeURIComponent(ticket.accountId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, isDone }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("save_failed");
        })
        .catch(() => toggleTicket(ticket.id, !isDone));
    },
    [toggleTicket],
  );

  const dragData = drag ? cardData.get(drag.id) : null;
  const visibleItems = items.filter(matches);
  const priorityCount = items.filter((i) => i.trackingStatus === "tasks_priority").length;
  const openCount = items.filter((i) => i.trackingStatus !== "tasks_done").length;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {heading}
        <p className="text-xs text-muted-foreground">
          <b className="font-semibold text-foreground">{priorityCount}</b> en prioridad ·{" "}
          <b className="font-semibold text-foreground">{openCount}</b> abiertas
        </p>
        <div className="ml-auto inline-flex rounded-lg bg-muted p-[3px]" role="group" aria-label="Filtrar por período">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              title={p.hint}
              aria-pressed={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                period === p.value && "bg-background text-foreground shadow-sm",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente o reunión…"
            aria-label="Buscar cliente o reunión"
            className="h-9 w-full rounded-lg border border-input bg-transparent pl-8 pr-8 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {q && !visibleItems.length && (
        <p role="status" className="shrink-0 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Ninguna card coincide con “{query.trim()}”.
        </p>
      )}

      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto overflow-y-hidden [scrollbar-width:thin] lg:min-h-0 lg:flex-1">
        {TRACKING_COLUMNS.map(({ status, label, hint }) => {
          const columnCards = visibleItems
            .filter((a) => a.trackingStatus === status && a.id !== drag?.id)
            .map((a) => a.data);
          const hasPlaceholder = drag?.over.status === status;
          return (
            <TrackingColumn
              key={status}
              status={status}
              label={label}
              hint={hint}
              cards={columnCards}
              count={columnCards.length + (hasPlaceholder ? 1 : 0)}
              placeholderIndex={hasPlaceholder ? Math.min(drag!.over.index, columnCards.length) : null}
              placeholderHeight={drag?.height ?? 0}
              isOver={hasPlaceholder && drag!.over.status !== drag!.origin.status}
              isDragging={!!drag}
              highlightedId={highlightedId}
              registerList={registerList}
              registerCard={registerCard}
              onCardPointerDown={onCardPointerDown}
              onOpen={onOpen}
              onToggle={toggleFromCard}
              archivedCount={status === "tasks_done" ? archived.length : undefined}
              onOpenArchive={status === "tasks_done" ? () => setArchiveOpen(true) : undefined}
            />
          );
        })}
      </div>

      {drag &&
        dragData &&
        createPortal(
          <div
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none fixed top-0 left-0 z-50 cursor-grabbing will-change-transform"
            style={{
              width: drag.width,
              transformOrigin: `${drag.offsetX}px ${drag.offsetY}px`,
            }}
          >
            <TrackingCardFace data={dragData} lifted />
          </div>,
          document.body,
        )}

      <TrackingDialog
        data={openId ? cardData.get(openId) ?? null : null}
        onClose={() => setOpenId(null)}
        onMove={moveTo}
        onToggleTicket={toggleTicket}
      />
      <ArchiveDialog
        open={archiveOpen}
        cards={archived}
        onClose={() => setArchiveOpen(false)}
        onOpenCard={(id) => {
          setArchiveOpen(false);
          setOpenId(id);
        }}
      />
    </>
  );
}
