"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TrackingColumn, PLACEHOLDER_KEY } from "@/components/tablero/TrackingColumn";
import { TrackingCardFace, type TrackingCardData } from "@/components/tablero/TrackingCard";
import { TrackingDialog } from "@/components/tablero/TrackingDialog";
import { TRACKING_COLUMNS } from "@/lib/tracking";
import { getLatestMeeting } from "@/lib/utils/meetings";
import type { Account, TrackingStatus } from "@/types/account";
import type { Meeting } from "@/types/meeting";
import type { Ticket } from "@/types/ticket";

// Drag-and-drop propio con pointer events (sin HTML5 DnD: su "ghost" nativo es el que
// arrastraba parte de la pantalla). Overlay flotante que sigue al puntero con inclinación
// según velocidad, placeholder que abre hueco en la columna destino y FLIP (Web Animations)
// para que el resto de las cards se reacomode con motion. El orden dentro de la columna
// es local; el status persiste vía PATCH /api/clients/[id].

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

export function TrackingBoard({
  accounts: initialAccounts,
  meetings,
  tickets: initialTickets,
  initialOpenId = null,
}: {
  accounts: Account[];
  meetings: Meeting[];
  tickets: Ticket[];
  initialOpenId?: string | null;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [doneIds, setDoneIds] = useState(() => new Set(initialTickets.filter((t) => t.isDone).map((t) => t.id)));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    initialOpenId && initialAccounts.some((a) => a.id === initialOpenId) ? initialOpenId : null,
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(initialOpenId);

  const tickets = useMemo(
    () => initialTickets.map((t) => ({ ...t, isDone: doneIds.has(t.id) })),
    [initialTickets, doneIds],
  );

  const cardData = useMemo(() => {
    const map = new Map<string, TrackingCardData>();
    for (const account of accounts) {
      const latestMeeting = getLatestMeeting(account.id, meetings);
      const own = tickets.filter((t) => t.accountId === account.id);
      const done = own.filter((t) => t.isDone).length;
      map.set(account.id, {
        account,
        latestMeeting,
        total: own.length,
        pending: own.length - done,
        engagementPercent: own.length ? Math.round((done / own.length) * 100) : 0,
      });
    }
    return map;
  }, [accounts, meetings, tickets]);

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
  const accountsRef = useRef(accounts);
  useLayoutEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

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
      accountsRef.current.filter((a) => a.trackingStatus === status && a.id !== excludeId),
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
    const account = accountsRef.current.find((a) => a.id === pd.id);
    if (!account) return;
    const rect = pd.el.getBoundingClientRect();
    const index = columnCards(account.trackingStatus, pd.id).filter(
      (a) => accountsRef.current.indexOf(a) < accountsRef.current.indexOf(account),
    ).length;
    const origin = { status: account.trackingStatus, index };
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
        setAccounts((prev) => {
          const moving = prev.find((a) => a.id === d.id);
          if (!moving) return prev;
          const rest = prev.filter((a) => a.id !== d.id);
          const updated = { ...moving, trackingStatus: target.status };
          const inCol = rest.filter((a) => a.trackingStatus === target.status);
          const before = inCol[target.index];
          if (before) rest.splice(rest.indexOf(before), 0, updated);
          else if (inCol.length) rest.splice(rest.indexOf(inCol[inCol.length - 1]) + 1, 0, updated);
          else rest.push(updated);
          return rest;
        });
        updateDrag(null);
        if (target.status !== d.origin.status) {
          void fetch(`/api/clients/${encodeURIComponent(d.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackingStatus: target.status }),
          });
        }
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
    [captureRects, updateDrag],
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
    const account = accounts.find((a) => a.id === id);
    if (!account || account.trackingStatus === status) return;
    captureRects();
    landedId.current = id;
    setAccounts((prev) => [
      ...prev.filter((a) => a.id !== id),
      { ...account, trackingStatus: status },
    ]);
    void fetch(`/api/clients/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingStatus: status }),
    });
  }

  function toggleTicket(ticketId: string, isDone: boolean) {
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (isDone) next.add(ticketId);
      else next.delete(ticketId);
      return next;
    });
  }

  const dragData = drag ? cardData.get(drag.id) : null;

  return (
    <>
      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto pb-4">
        {TRACKING_COLUMNS.map(({ status, label }) => {
          const cards = accounts
            .filter((a) => a.trackingStatus === status && a.id !== drag?.id)
            .map((a) => cardData.get(a.id)!);
          const hasPlaceholder = drag?.over.status === status;
          return (
            <TrackingColumn
              key={status}
              status={status}
              label={label}
              cards={cards}
              count={cards.length + (hasPlaceholder ? 1 : 0)}
              placeholderIndex={hasPlaceholder ? Math.min(drag!.over.index, cards.length) : null}
              placeholderHeight={drag?.height ?? 0}
              isOver={hasPlaceholder && drag!.over.status !== drag!.origin.status}
              isDragging={!!drag}
              highlightedId={highlightedId}
              registerList={registerList}
              registerCard={registerCard}
              onCardPointerDown={onCardPointerDown}
              onOpen={onOpen}
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
        tickets={tickets}
        onClose={() => setOpenId(null)}
        onMove={moveTo}
        onToggleTicket={toggleTicket}
      />
    </>
  );
}
