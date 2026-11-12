"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, SpellCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addCorrection } from "@/components/accionables/format";

// Correcciones aprendidas: se aplican a todo lo guardado y a cada minuta / transcripción nueva.

export function CorrectionsDialog({ corrections }: { corrections: { from: string; to: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!from.trim() || !to.trim()) return;
    setBusy(true);
    if (await addCorrection(from, to)) {
      setFrom("");
      setTo("");
      router.refresh();
    }
    setBusy(false);
  }

  async function remove(f: string) {
    setBusy(true);
    await fetch(`/api/settings/corrections?from=${encodeURIComponent(f)}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-surface px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <SpellCheck className="size-3.5" /> Correcciones
        {corrections.length > 0 && <span className="tabular text-subtle-foreground">{corrections.length}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correcciones aprendidas</DialogTitle>
            <DialogDescription>
              Palabras o nombres que Gemini transcribe mal. Se corrigen en lo ya guardado y en cada minuta nueva.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Extract" aria-label="Texto mal escrito" className={cn(inputClass, "h-8 text-sm")} />
            <ArrowRight className="size-4 shrink-0 text-subtle-foreground" />
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="Xtract"
              aria-label="Texto correcto"
              className={cn(inputClass, "h-8 text-sm")}
            />
            <Button size="icon-sm" disabled={busy || !from.trim() || !to.trim()} onClick={add} aria-label="Agregar corrección">
              <Plus />
            </Button>
          </div>
          {corrections.length ? (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border [scrollbar-width:thin]">
              {corrections.map((c) => (
                <li key={c.from} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground line-through decoration-subtle-foreground/60">{c.from}</span>
                  <ArrowRight className="size-3.5 text-subtle-foreground" />
                  <span className="font-medium text-foreground">{c.to}</span>
                  <Button size="icon-xs" variant="ghost" className="ml-auto" disabled={busy} onClick={() => remove(c.from)} aria-label={`Quitar ${c.from}`}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-subtle-foreground">Todavía no hay. También se ofrecen solas cuando editás un accionable.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
