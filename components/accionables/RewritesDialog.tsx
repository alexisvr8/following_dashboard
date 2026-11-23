"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RewriteItem } from "@/lib/utils/account-analysis";
import { fmtShortDate } from "@/components/accionables/format";

// "Mejoras IA": reescrituras que propuso el análisis semanal para accionables con texto pobre (minutas por reglas).
// Aceptar guarda el texto como edición del accionable (no cambia ids, estado ni fecha); descartar la oculta.
// Nada se aplica solo. `PATCH /api/clients/[id] {rewrite: {ref, action, title?}}` (`resolveRewrite`).

export function RewritesDialog({ rewrites, open, onOpenChange }: { rewrites: RewriteItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const pending = rewrites.filter((r) => !resolved.has(r.id));

  async function resolve(r: RewriteItem, action: "accept" | "dismiss") {
    const title = (drafts[r.id] ?? r.proposed).trim();
    if (action === "accept" && !title) return;
    setBusy(r.id);
    setError(null);
    setResolved((s) => new Set(s).add(r.id));
    const res = await fetch(`/api/clients/${encodeURIComponent(r.clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewrite: { ref: r.ref, action, ...(action === "accept" && { title }) } }),
    }).catch(() => null);
    if (!res?.ok) {
      setResolved((s) => {
        const next = new Set(s);
        next.delete(r.id);
        return next;
      });
      setError("No se pudo guardar. Probá de nuevo.");
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Mejoras de redacción (IA)</DialogTitle>
            <DialogDescription>
              El análisis semanal propone un texto más claro para estos accionables, con los datos de la minuta y los
              mails. Aceptar (podés corregirlo antes) solo cambia el texto: no toca estado, fecha ni responsables tildados.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-critical">{error}</p>}
          {!pending.length ? (
            <p className="py-6 text-center text-sm text-subtle-foreground">No hay mejoras pendientes de revisar.</p>
          ) : (
            <ul className="-mx-4 min-h-0 divide-y divide-border overflow-y-auto border-t border-border [scrollbar-width:thin]">
              {pending.map((r) => {
                const isBusy = busy === r.id;
                return (
                  <li key={r.id} className={cn("space-y-2 px-3 py-3", isBusy && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-sm text-subtle-foreground">
                      <span className="font-medium text-foreground">{r.clientName}</span>
                      <span>· Análisis {fmtShortDate(r.generatedAt)}</span>
                      <Badge variant="outline">{r.ref}</Badge>
                    </div>
                    <p className="text-[13px] leading-snug text-subtle-foreground line-through decoration-border-strong">
                      {r.current}
                    </p>
                    <textarea
                      value={drafts[r.id] ?? r.proposed}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      rows={2}
                      aria-label="Texto propuesto"
                      className={cn(inputClass, "h-auto min-h-16 w-full resize-y py-1.5 text-[13px] leading-snug")}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 text-label-sm text-muted-foreground">{r.motivo}</p>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="xs" disabled={isBusy} onClick={() => resolve(r, "accept")}>
                          <Check /> Aceptar
                        </Button>
                        <Button size="xs" variant="outline" disabled={isBusy} onClick={() => resolve(r, "dismiss")}>
                          <X /> Descartar
                        </Button>
                      </div>
                    </div>
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
