"use client";

import { useState } from "react";
import { Check, MessageSquareQuote, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SuggestedItem } from "@/lib/utils/deadlines";
import { fmtShortDate } from "@/components/accionables/format";

// Compromisos y pedidos detectados en la transcripción que Gemini no listó. Viven detrás de un botón en la
// barra de /accionables (modal), para no ocupar el tablero. Aceptar crea un accionable
// propio (con el texto corregido y, si se dijo, la fecha); descartar enseña a no volver a sugerir algo parecido.

export function SuggestionsDialog({
  suggestions,
  busy,
  onResolve,
}: {
  suggestions: SuggestedItem[];
  busy: string | null;
  onResolve: (s: SuggestedItem, action: "accept" | "dismiss", title?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Compromisos dichos en la reunión que Gemini no puso en Próximos pasos"
        className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-surface px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquareQuote className="size-3.5" /> De la reunión
        {suggestions.length > 0 && <span className="tabular text-subtle-foreground">{suggestions.length}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dicho en la reunión</DialogTitle>
            <DialogDescription>
              Compromisos y pedidos de la transcripción que Gemini no puso en Próximos pasos. Aceptá (podés corregir el
              texto) o descartá: lo descartado enseña a no volver a sugerir algo parecido.
            </DialogDescription>
          </DialogHeader>
          {!suggestions.length ? (
            <p className="py-6 text-center text-sm text-subtle-foreground">No hay nada pendiente de revisar.</p>
          ) : (
        <ul className="-mx-4 min-h-0 divide-y divide-border overflow-y-auto border-t border-border [scrollbar-width:thin]">
          {suggestions.map((s) => {
            const isEditing = editing === s.id;
            const isBusy = busy === s.id;
            return (
              <li key={s.id} className={cn("space-y-2 px-3 py-2.5", isBusy && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-sm text-subtle-foreground">
                  <span className="font-medium text-foreground">{s.clientName}</span>
                  <span>
                    · Reunión {fmtShortDate(s.meetingDate)} · min {s.ts.slice(0, 5)}
                    {s.atClose && " · cierre"}
                  </span>
                  <Badge variant={s.side === "debo" ? "secondary" : "outline"}>
                    {s.side === "debo" ? "Debo" : `Me deben${s.owner ? ` · ${s.owner.split(/\s+/)[0]}` : ""}`}
                  </Badge>
                  {s.dueLabel && <Badge variant="outline">Fecha dicha: {s.dueLabel}</Badge>}
                </div>
                {isEditing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draft.trim()) onResolve(s, "accept", draft);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      aria-label="Texto del accionable"
                      className={cn(inputClass, "h-8 min-w-0 flex-1 text-sm")}
                    />
                    <Button size="sm" disabled={isBusy || !draft.trim()} onClick={() => onResolve(s, "accept", draft)}>
                      <Check /> Agregar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-2">
                    <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground">
                      <span className="text-muted-foreground">{s.speaker}: </span>«{s.text}»
                    </p>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="xs"
                        disabled={isBusy}
                        onClick={() => {
                          setEditing(s.id);
                          setDraft(s.text);
                        }}
                      >
                        <Check /> Aceptar
                      </Button>
                      <Button size="xs" variant="outline" disabled={isBusy} onClick={() => onResolve(s, "dismiss")}>
                        <X /> Descartar
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
