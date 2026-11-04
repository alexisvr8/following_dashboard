"use client";

import { Archive } from "lucide-react";
import { TrackingCardFace, type TrackingCardData } from "@/components/tablero/TrackingCard";
import { cn } from "@/lib/utils";
import type { TrackingStatus } from "@/types/account";
import type { Ticket } from "@/types/ticket";

export const PLACEHOLDER_KEY = "__placeholder__";

export function TrackingColumn({
  label,
  hint,
  status,
  cards,
  count,
  placeholderIndex,
  placeholderHeight,
  isOver,
  isDragging,
  highlightedId,
  registerList,
  registerCard,
  onCardPointerDown,
  onOpen,
  onToggle,
  archivedCount,
  onOpenArchive,
}: {
  label: string;
  hint: string;
  status: TrackingStatus;
  cards: TrackingCardData[];
  count: number;
  /** null = sin placeholder en esta columna. */
  placeholderIndex: number | null;
  placeholderHeight: number;
  isOver: boolean;
  isDragging: boolean;
  highlightedId: string | null;
  registerList: (status: TrackingStatus, el: HTMLElement | null) => void;
  registerCard: (id: string, el: HTMLElement | null) => void;
  onCardPointerDown: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (ticket: Ticket, isDone: boolean) => void;
  /** Solo en Finalizadas. */
  archivedCount?: number;
  onOpenArchive?: () => void;
}) {
  const items: React.ReactNode[] = cards.map((card) => (
    <div
      key={card.card.id}
      ref={(el) => registerCard(card.card.id, el)}
      data-card-id={card.card.id}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => onCardPointerDown(e, card.card.id)}
      onClick={() => onOpen(card.card.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(card.card.id);
        }
      }}
      className="cursor-grab touch-manipulation rounded-xl outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TrackingCardFace data={card} highlighted={highlightedId === card.card.id} onToggle={onToggle} />
    </div>
  ));

  if (placeholderIndex != null) {
    items.splice(
      placeholderIndex,
      0,
      <div
        key={PLACEHOLDER_KEY}
        ref={(el) => registerCard(PLACEHOLDER_KEY, el)}
        style={{ height: placeholderHeight }}
        className="animate-in fade-in-0 zoom-in-95 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 duration-200"
      />,
    );
  }

  return (
    <div
      className={cn(
        "flex w-80 shrink-0 flex-col gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-transparent transition-[background-color,box-shadow,ring-color] duration-200 lg:min-h-0 lg:w-auto lg:min-w-72 lg:flex-1 lg:basis-0",
        isOver && "bg-primary/[0.06] ring-primary/30",
        isDragging && !isOver && "bg-muted/30",
      )}
    >
      <div className="flex shrink-0 items-center justify-between px-1" title={hint}>
        <h3 className={cn("flex items-center gap-1.5 text-sm font-semibold transition-colors", isOver && "text-primary")}>
          {status === "tasks_priority" && <span className="size-2 rounded-full bg-amber-500" aria-hidden />}
          {label}
        </h3>
        <span
          key={count}
          className="animate-in zoom-in-50 rounded-full bg-background px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground duration-300"
        >
          {count}
        </span>
      </div>
      <div
        ref={(el) => registerList(status, el)}
        className="flex min-h-24 flex-col gap-2.5 p-px [scrollbar-width:thin] lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
      >
        {items}
        {!items.length && (
          <p className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
            Sin cards
          </p>
        )}
      </div>
      {onOpenArchive && (
        <button
          type="button"
          onClick={onOpenArchive}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Archive className="size-3.5" /> Ver archivo ({archivedCount ?? 0})
        </button>
      )}
    </div>
  );
}
