"use client";

import { TrackingCardFace, type TrackingCardData } from "@/components/tablero/TrackingCard";
import { cn } from "@/lib/utils";
import type { TrackingStatus } from "@/types/account";

export const PLACEHOLDER_KEY = "__placeholder__";

export function TrackingColumn({
  label,
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
}: {
  label: string;
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
}) {
  const items: React.ReactNode[] = cards.map((card) => (
    <div
      key={card.account.id}
      ref={(el) => registerCard(card.account.id, el)}
      data-card-id={card.account.id}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => onCardPointerDown(e, card.account.id)}
      onClick={() => onOpen(card.account.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(card.account.id);
        }
      }}
      className="cursor-grab touch-manipulation rounded-xl outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TrackingCardFace data={card} highlighted={highlightedId === card.account.id} />
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
        "flex w-72 shrink-0 flex-col gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-transparent transition-[background-color,box-shadow,ring-color] duration-200",
        isOver && "bg-primary/[0.06] ring-primary/30",
        isDragging && !isOver && "bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className={cn("text-xs font-medium text-muted-foreground transition-colors", isOver && "text-primary")}>
          {label}
        </h3>
        <span
          key={count}
          className="animate-in zoom-in-50 rounded-full bg-background px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground duration-300"
        >
          {count}
        </span>
      </div>
      <div ref={(el) => registerList(status, el)} className="flex min-h-24 flex-col gap-2">
        {items}
        {!items.length && (
          <p className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
            Arrastra una cuenta acá
          </p>
        )}
      </div>
    </div>
  );
}
