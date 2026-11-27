"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, Plus, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WeeklyReviewEntry } from "@/lib/utils/weekly-learning";

// "Del mail semanal": diferencias entre el borrador de los lunes y lo que enviaste (`captureWeeklyOutcomes`).
// Punto que sacaste → Hecho / No corresponde / Sigue abierto; punto que agregaste → Crear card (texto editable +
// fecha) / Ignorar; cuenta sin mail → Confirmar (con motivo). Nada se aplica solo.
// `PATCH /api/clients/[id] {weeklyReview: {id, action, title?, due?, reason?}}` (`resolveWeeklyReview`).

type Action = "done" | "not_applicable" | "keep" | "create" | "ignore" | "ok";

const REASONS = ["Hubo reunión esta semana", "Esperando al cliente (ya está pedido)", "Proyecto en pausa", "Se habló por otro canal", "Nada para pedir"];

const KIND_LABEL = { removed: "Lo sacaste", added: "Lo agregaste", skipped: "Sin mail", marked_done: "Lo marcaste hecho" } as const;

const ddmm = (w: string) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;
const originLabel = (i: WeeklyReviewEntry["item"]) =>
  i.source === "minuta" ? `minuta del ${ddmm(i.week)}` : i.source === "viernes" ? `resumen del viernes · semana del ${ddmm(i.week)}` : `mail semanal · semana del ${ddmm(i.week)}`;

/** Lo sugerido para "Aplicar lo sugerido": minuta y viernes = sacado → No corresponde, marcado → Hecho; el semanal no tiene default. */
const suggested = (i: WeeklyReviewEntry["item"]): Action | null =>
  i.source !== "minuta" && i.source !== "viernes" ? null : i.kind === "removed" ? "not_applicable" : i.kind === "marked_done" ? "done" : null;

export function WeeklyReviewDialog({
  entries,
  open,
  onOpenChange,
}: {
  entries: WeeklyReviewEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [dues, setDues] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // El id del ítem es único solo dentro de la cuenta (p. ej. `<semana>:skipped`): el estado del modal va por cuenta + id.
  const keyOf = (e: WeeklyReviewEntry) => `${e.clientId}|${e.item.id}`;
  const pending = entries.filter((e) => !resolved.has(keyOf(e)));

  const fullText = (e: WeeklyReviewEntry) =>
    `${e.item.owner ? `[${e.item.owner}] ` : ""}${e.item.title}${e.item.detail ? `: ${e.item.detail}` : ""}`;

  async function resolve(e: WeeklyReviewEntry, action: Action) {
    const key = keyOf(e);
    setBusy(key);
    setError(null);
    setResolved((s) => new Set(s).add(key));
    const payload = {
      id: e.item.id,
      action,
      ...(action === "create" && { title: (texts[key] ?? fullText(e)).trim(), due: dues[key] || null }),
      ...(action === "ok" && reasons[key] && { reason: reasons[key] }),
    };
    const res = await fetch(`/api/clients/${encodeURIComponent(e.clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeklyReview: payload }),
    }).catch(() => null);
    if (!res?.ok) {
      setResolved((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      setError("No se pudo guardar. Probá de nuevo.");
    }
    setBusy(null);
    router.refresh();
  }

  async function applySuggested() {
    for (const e of pending) {
      const action = suggested(e.item);
      if (action) await resolve(e, action);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Revisión de lo enviado</DialogTitle>
            <DialogDescription>
              Lo que cambiaste respecto del borrador (resumen del viernes, mail de los lunes y minutas enviadas desde Gmail). Decidí cada punto
              para que no se acumulen: lo que sacaste puede estar hecho o no corresponder, lo que marcaste hecho se cierra y
              lo que agregaste puede pasar al tablero como card.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-critical">{error}</p>}
          {pending.some((e) => suggested(e.item)) && (
            <div className="flex justify-end">
              <Button size="xs" variant="outline" disabled={!!busy} onClick={applySuggested}>
                <Check /> Aplicar lo sugerido ({pending.filter((e) => suggested(e.item)).length})
              </Button>
            </div>
          )}
          {!pending.length ? (
            <p className="py-6 text-center text-sm text-subtle-foreground">No hay nada pendiente de revisar.</p>
          ) : (
            <ul className="-mx-4 min-h-0 divide-y divide-border overflow-y-auto border-t border-border [scrollbar-width:thin]">
              {pending.map((e) => {
                const { item } = e;
                const k = keyOf(e);
                const isBusy = busy === k;
                return (
                  <li key={k} className={cn("space-y-2 px-3 py-3", isBusy && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-sm text-subtle-foreground">
                      <span className="font-medium text-foreground">{e.clientName}</span>
                      <span>· {originLabel(item)}</span>
                      <Badge variant={item.kind === "added" || item.kind === "marked_done" ? "success" : item.kind === "removed" ? "warning" : "outline"}>
                        {KIND_LABEL[item.kind]}
                      </Badge>
                    </div>

                    {item.kind === "skipped" ? (
                      <>
                        <p className="text-[13px] leading-snug">{item.title}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={reasons[k] ?? ""}
                            onChange={(ev) => setReasons((r) => ({ ...r, [k]: ev.target.value }))}
                            aria-label="Motivo"
                            className={cn(inputClass, "h-7 w-auto min-w-56 text-xs")}
                          >
                            <option value="">Motivo (opcional)</option>
                            {REASONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <div className="ml-auto flex shrink-0 gap-1.5">
                            <Button size="xs" disabled={isBusy} onClick={() => resolve(e, "ok")}>
                              <Check /> No correspondía
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : item.kind === "removed" || item.kind === "marked_done" ? (
                      <>
                        <p className="text-[13px] leading-snug">
                          <b className="font-medium">{item.title}</b>
                          {item.owner && <span className="text-muted-foreground"> ({item.owner})</span>}
                          {item.detail && <span className="text-muted-foreground">: {item.detail}</span>}
                        </p>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            size="xs"
                            variant={suggested(item) === "not_applicable" ? "outline" : "default"}
                            disabled={isBusy}
                            onClick={() => resolve(e, "done")}
                          >
                            <Check /> Hecho
                          </Button>
                          <Button
                            size="xs"
                            variant={suggested(item) === "not_applicable" ? "default" : "outline"}
                            disabled={isBusy}
                            onClick={() => resolve(e, "not_applicable")}
                          >
                            <CircleSlash /> No corresponde
                          </Button>
                          <Button size="xs" variant="ghost" disabled={isBusy} onClick={() => resolve(e, "keep")}>
                            <Undo2 /> Sigue abierto
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <textarea
                          value={texts[k] ?? fullText(e)}
                          onChange={(ev) => setTexts((t) => ({ ...t, [k]: ev.target.value }))}
                          rows={3}
                          aria-label="Texto del accionable"
                          className={cn(inputClass, "h-auto min-h-16 w-full resize-y py-1.5 text-[13px] leading-snug")}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1.5 text-label-sm text-muted-foreground">
                            Fecha
                            <input
                              type="date"
                              value={dues[k] ?? ""}
                              onChange={(ev) => setDues((d) => ({ ...d, [k]: ev.target.value }))}
                              className={cn(inputClass, "h-7 w-auto text-xs")}
                            />
                          </label>
                          <div className="ml-auto flex shrink-0 gap-1.5">
                            <Button size="xs" disabled={isBusy} onClick={() => resolve(e, "create")}>
                              <Plus /> Crear card
                            </Button>
                            <Button size="xs" variant="outline" disabled={isBusy} onClick={() => resolve(e, "ignore")}>
                              <X /> Ignorar
                            </Button>
                          </div>
                        </div>
                      </>
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
