"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CalendarPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Cierre de cuenta (pase a Soporte al terminar la Etapa 2): `status: "closed"` + `profile.closure`.
// Libera Capacidad, accionables, alertas, IA y sync; los accionables quedan congelados tal cual.

async function patch(clientId: string, body: unknown): Promise<boolean> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return Boolean(res?.ok);
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });

export function ClosedBadge({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <Badge variant="secondary" title="Cuenta cerrada: pasó a Soporte" className={cn(size === "sm" && "px-1.5 text-[10.5px]", className)}>
      <Archive className="size-3" /> {size === "sm" ? "Cerrada" : "Cerrada · Soporte"}
    </Badge>
  );
}

/** Botón "Pasar a Soporte" + modal con lo que queda abierto (aviso, no frena el cierre). */
export function CloseAccountButton({
  clientId,
  name,
  openDebo,
  openMeDeben,
}: {
  clientId: string;
  name: string;
  openDebo: number;
  openMeDeben: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [handedTo, setHandedTo] = useState("Soporte");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = openDebo + openMeDeben;

  async function confirm() {
    setBusy(true);
    setError(false);
    const ok = await patch(clientId, { close: { handedTo, note } });
    setBusy(false);
    if (!ok) return setError(true);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Terminó la integración: libera su espacio en Capacidad, accionables y alertas"
      >
        <Archive /> Pasar a Soporte
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar {name}</DialogTitle>
            <DialogDescription>
              Sale de Capacidad, accionables, alertas, análisis IA, borradores automáticos y sincronización. Todo lo guardado se
              conserva y podés reabrirla cuando quieras.
            </DialogDescription>
          </DialogHeader>
          {pending > 0 ? (
            <p className="rounded-md border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
              Quedan <b className="tabular">{openDebo}</b> accionable{openDebo === 1 ? "" : "s"} tuyo{openDebo === 1 ? "" : "s"} y{" "}
              <b className="tabular">{openMeDeben}</b> que te deben. Quedan congelados tal cual (no se marcan como hechos).
            </p>
          ) : (
            <p className="rounded-md border border-success/25 bg-success-muted px-3 py-2 text-xs text-foreground">
              Sin accionables abiertos.
            </p>
          )}
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="text-label-sm uppercase">Pasa a</span>
            <input value={handedTo} onChange={(e) => setHandedTo(e.target.value)} className={cn(inputClass, "h-8 text-sm")} />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span className="text-label-sm uppercase">Nota (opcional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Ej.: integración en producción, handoff hecho con Soporte."
              className={cn(inputClass, "h-auto py-1.5 text-sm")}
            />
          </label>
          {error && <p className="text-xs text-critical">No se pudo cerrar. Probá de nuevo.</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button size="sm" onClick={confirm} disabled={busy}>
              <Archive /> {busy ? "Cerrando…" : "Cerrar cuenta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Franja de cuenta cerrada: fecha, a quién pasó, nota, reuniones posteriores al cierre y "Reabrir". */
export function ClosedBanner({
  clientId,
  closure,
  newMeetings,
}: {
  clientId: string;
  closure: { at: string; handedTo: string; note?: string } | null;
  newMeetings: { title: string; date: string }[];
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border-strong bg-accent px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Archive className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-foreground">
          Cuenta cerrada{closure ? ` el ${fmtDay(closure.at)} · pasó a ${closure.handedTo}` : ""}. No ocupa Capacidad ni genera
          accionables, alertas ni borradores.
        </span>
        <ReopenButton clientId={clientId} size="xs" />
      </div>
      {closure?.note && <p className="text-muted-foreground">{closure.note}</p>}
      {newMeetings.length > 0 && <NewMeetingsNotice meetings={newMeetings} />}
    </div>
  );
}

/** Aviso de reuniones después del cierre (`meetingsAfterClosure`, más nueva primero). */
export function NewMeetingsNotice({ meetings }: { meetings: { title: string; date: string }[] }) {
  const last = meetings[0];
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-warning/25 bg-warning-muted px-2 py-1 text-xs text-foreground">
      <CalendarPlus className="mt-px size-3.5 shrink-0 text-warning" />
      <span className="min-w-0">
        {meetings.length === 1 ? "Hubo una reunión" : `Hubo ${meetings.length} reuniones`} después del cierre (última: “{last.title}”,{" "}
        <span className="tabular">{fmtDay(last.date)}</span>). ¿Volvió a tu cargo? Reabrila.
      </span>
    </p>
  );
}

export function ReopenButton({ clientId, size = "sm" }: { clientId: string; size?: "xs" | "sm" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (await patch(clientId, { reopen: true })) router.refresh();
        setBusy(false);
      }}
    >
      <ArchiveRestore /> {busy ? "Reabriendo…" : "Reabrir"}
    </Button>
  );
}
