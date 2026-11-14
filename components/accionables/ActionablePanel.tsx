"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowUpRight, Ban, CalendarClock, Check, Clock, Mail, Pencil, RotateCcw, SpellCheck, Users, X } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PlannedItem } from "@/lib/utils/deadlines";
import {
  addWorkdays,
  correctionCandidate,
  DUE_KIND,
  personKey,
  ROLE_LABEL,
  type Role,
  ESTIMATES,
  fmtLongDate,
  fmtMinutes,
  isoDay,
  PRIORITY,
  relativeDue,
} from "@/components/accionables/format";

// Detalle de un accionable (modal centrado): texto completo, origen, plazo (posponer / fecha manual), estimación
// y acciones (hecho, no corresponde, abrir cuenta, reclamar). Todo persiste en la cuenta.

export type PanelAction =
  | { type: "done" }
  | { type: "remove" }
  | { type: "due"; due: string | null }
  | { type: "estimate"; minutes: number }
  | { type: "edit"; text: string }
  | { type: "side"; side: "debo" | "me_deben" | null }
  | { type: "role"; name: string; role: Role | null }
  | { type: "correction"; from: string; to: string };

// "warning" de `relativeDue` = vence hoy: azul (`due-today`), igual que el color de la card.
const TONE_TEXT = { critical: "text-critical", warning: "text-due-today", muted: "text-muted-foreground" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-2">
      <dt className="text-label-sm uppercase text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function ActionablePanel({
  item,
  open,
  busy,
  workDays,
  targetDays,
  limitDays,
  people,
  onOpenChange,
  onAction,
}: {
  people: Record<string, Role>;
  item: PlannedItem | null;
  open: boolean;
  busy: boolean;
  workDays: number[];
  targetDays: number;
  limitDays: number;
  onOpenChange: (open: boolean) => void;
  onAction: (item: PlannedItem, action: PanelAction) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/60 duration-150 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border-strong bg-popover text-popover-foreground shadow-popover outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          {item && (
            <PanelBody
              key={item.id}
              item={item}
              busy={busy}
              workDays={workDays}
              targetDays={targetDays}
              limitDays={limitDays}
              people={people}
              onAction={onAction}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PanelBody({
  item,
  busy,
  workDays,
  targetDays,
  limitDays,
  people,
  onAction,
}: {
  people: Record<string, Role>;
  item: PlannedItem;
  busy: boolean;
  workDays: number[];
  targetDays: number;
  limitDays: number;
  onAction: (item: PlannedItem, action: PanelAction) => void;
}) {
  const p = PRIORITY[item.priority];
  const rel = relativeDue(item);
  const origin = item.originKind === "mail" ? "el mail" : "la reunión";
  const dueHelp =
    item.dueKind === "agreed"
      ? `Se dijo en ${origin} del ${fmtLongDate(item.originDate)}.`
      : item.dueKind === "manual"
        ? "La pusiste a mano. Va en los mails al cliente."
        : `No se dijo fecha: meta de ${targetDays} días hábiles desde ${origin}, vence a los ${limitDays}. No se muestra al cliente.`;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [owners, setOwners] = useState(item.owners.join(", "));
  const [mailText, setMailText] = useState(item.fullText);
  const [offer, setOffer] = useState<{ from: string; to: string } | null>(null);

  const startEdit = () => {
    setTitle(item.title);
    setDetail(item.detail ?? "");
    setOwners(item.owners.join(", "));
    setMailText(item.fullText);
    setEditing(true);
  };
  function save() {
    let before: string;
    let after: string;
    let text: string;
    if (item.editable === "mail") {
      before = item.fullText;
      after = text = mailText.trim();
    } else {
      const who = owners.split(",").map((o) => o.trim()).filter(Boolean);
      const body = `${title.trim()}${detail.trim() ? `: ${detail.trim()}` : ""}`;
      text = `${who.length ? `[${who.join(", ")}] ` : ""}${body}`;
      before = `${item.owners.join(" ")} ${item.title} ${item.detail ?? ""}`;
      after = `${who.join(" ")} ${title.trim()} ${detail.trim()}`;
    }
    setEditing(false);
    if (!text || after === before) return;
    onAction(item, { type: "edit", text });
    setOffer(correctionCandidate(before, after));
  }

  // Posponer desde la fecha actual o desde hoy, lo que sea más tarde.
  const postpone = (n: number) => {
    const base = new Date(Math.max(Date.now(), Date.parse(item.due)));
    onAction(item, { type: "due", due: isoDay(addWorkdays(base, n, workDays)) });
  };

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/cuentas/${encodeURIComponent(item.clientId)}`}
            className="flex items-center gap-1 text-label-sm uppercase text-muted-foreground hover:text-foreground"
          >
            <span className="truncate">{item.clientName}</span>
            {item.erp && <span className="text-subtle-foreground">· {item.erp}</span>}
            <ArrowUpRight className="size-3 shrink-0" />
          </Link>
          <DialogPrimitive.Title className="text-base leading-snug font-semibold text-foreground-strong">{item.title}</DialogPrimitive.Title>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.editable && !editing && (
            <Button variant="ghost" size="sm" onClick={startEdit} disabled={busy}>
              <Pencil /> Editar
            </Button>
          )}
          <DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" aria-label="Cerrar" />}>
            <X />
          </DialogPrimitive.Close>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
        {editing ? (
          <div className="space-y-3 rounded-lg border border-border-strong bg-card p-3">
            {item.editable === "mail" ? (
              <label className="block space-y-1">
                <span className="text-label-sm uppercase text-subtle-foreground">Texto</span>
                <textarea value={mailText} onChange={(e) => setMailText(e.target.value)} rows={3} className={cn(inputClass, "py-2 text-sm")} />
              </label>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-label-sm uppercase text-subtle-foreground">Título</span>
                  <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={cn(inputClass, "h-8 text-sm")} />
                </label>
                <label className="block space-y-1">
                  <span className="text-label-sm uppercase text-subtle-foreground">Detalle</span>
                  <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} className={cn(inputClass, "py-2 text-sm")} />
                </label>
                <label className="block space-y-1">
                  <span className="text-label-sm uppercase text-subtle-foreground">Responsables (separados por coma)</span>
                  <input value={owners} onChange={(e) => setOwners(e.target.value)} placeholder="Alexis Vásquez R, Facundo Sosa" className={cn(inputClass, "h-8 text-sm")} />
                </label>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save} disabled={busy || (item.editable === "step" ? !title.trim() : !mailText.trim())}>
                <Check /> Guardar
              </Button>
            </div>
          </div>
        ) : (
          item.detail && (
            <DialogPrimitive.Description className="text-sm leading-relaxed text-muted-foreground">{item.detail}</DialogPrimitive.Description>
          )
        )}

        {offer && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground">
            <SpellCheck className="size-3.5 text-muted-foreground" />
            <span>
              ¿Corregir siempre «<b className="font-medium">{offer.from}</b>» → «<b className="font-medium">{offer.to}</b>» en minutas y transcripciones?
            </span>
            <span className="ml-auto flex gap-1.5">
              <Button
                size="xs"
                onClick={() => {
                  onAction(item, { type: "correction", ...offer });
                  setOffer(null);
                }}
              >
                Sí, siempre
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setOffer(null)}>
                Solo acá
              </Button>
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={p.tone === "neutral" ? "outline" : p.tone}>
            <StatusDot tone={p.tone} /> Prioridad {p.label.toLowerCase()}
          </Badge>
          <span className="flex rounded-md border border-input bg-surface p-0.5" role="group" aria-label="Lado">
            {(["debo", "me_deben"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={item.side === s}
                disabled={busy}
                onClick={() => item.side !== s && onAction(item, { type: "side", side: s })}
                className={cn(
                  "rounded px-2 py-0.5 text-label-sm transition-colors",
                  item.side === s ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "debo" ? "Debo" : "Me deben"}
              </button>
            ))}
          </span>
          {item.sideManual && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(item, { type: "side", side: null })}
              className="text-label-sm text-subtle-foreground hover:text-foreground"
              title="Volver al lado detectado"
            >
              <RotateCcw className="inline size-3" /> auto
            </button>
          )}
          {item.carried && <Badge variant="outline">Arrastrado</Badge>}
          {item.atRisk && <Badge variant="critical">Sin espacio</Badge>}
        </div>

        <dl className="divide-y divide-border rounded-lg border border-border bg-card px-3">
          <Row label="Origen">
            <span className="flex items-start gap-1.5">
              {item.originKind === "mail" ? <Mail className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" /> : <Users className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />}
              <span>
                {item.originTitle.replace(/^Mail: /, "")}
                <span className="block text-xs text-muted-foreground">{fmtLongDate(item.originDate)}</span>
              </span>
            </span>
          </Row>
          {item.owners.length > 0 && (
            <Row label="Responsable">
              <ul className="space-y-1.5">
                {item.owners.map((o) => (
                  <li key={o} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{o}</span>
                    <select
                      aria-label={`Rol de ${o}`}
                      title="Se recuerda para todas las cuentas"
                      value={people[personKey(o)] ?? ""}
                      disabled={busy}
                      onChange={(e) => onAction(item, { type: "role", name: o, role: (e.target.value || null) as Role | null })}
                      className="rounded-md border border-input bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus-visible:border-ring"
                    >
                      <option value="">Rol: detectar solo</option>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {item.fullText !== item.title && (
            <Row label="Texto original">
              <span className="text-xs leading-relaxed text-muted-foreground">{item.fullText}</span>
            </Row>
          )}
        </dl>

        <section className="space-y-2.5">
          <h3 className="text-label-sm uppercase text-subtle-foreground">Plazo</h3>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className={cn("text-sm font-medium", TONE_TEXT[rel.tone])}>{rel.text}</span>
              <span className="tabular text-xs text-muted-foreground">
                <CalendarClock className="mr-1 inline size-3.5 align-[-2px]" />
                {fmtLongDate(item.due)}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              <b className="font-medium text-foreground">{DUE_KIND[item.dueKind]}.</b> {dueHelp}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button size="xs" variant="outline" disabled={busy} onClick={() => postpone(1)}>
                +1 día háb.
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => postpone(5)}>
                +1 semana
              </Button>
              <input
                type="date"
                aria-label="Elegir fecha"
                value={isoDay(new Date(item.due))}
                disabled={busy}
                onChange={(e) => e.target.value && onAction(item, { type: "due", due: e.target.value })}
                className="tabular h-6 rounded-md border border-input bg-surface px-1.5 text-xs text-foreground outline-none focus-visible:border-ring"
              />
              {item.dueKind === "manual" && (
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction(item, { type: "due", due: null })}>
                  <RotateCcw /> Restaurar
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-2.5">
          <h3 className="flex items-center gap-1.5 text-label-sm uppercase text-subtle-foreground">
            <Clock className="size-3.5" /> Tiempo estimado
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {ESTIMATES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => onAction(item, { type: "estimate", minutes: m })}
                className={cn(
                  "tabular rounded-md border px-2 py-1 text-xs transition-colors",
                  item.estimateMinutes === m
                    ? "border-border-strong bg-accent font-medium text-foreground"
                    : "border-input bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                {fmtMinutes(m)}
              </button>
            ))}
          </div>
          {item.estimateSource === "ai" && (
            <p className="text-xs text-subtle-foreground">
              Estimada por la IA con el contexto de la minuta y los mails ({fmtMinutes(item.estimateMinutes)}). Elegí otra para ajustarla.
            </p>
          )}
          {item.estimateSource === "learned" && (
            <p className="text-xs text-subtle-foreground">
              Aprendida de «{item.estimateFrom}» ({fmtMinutes(item.estimateMinutes)}). Elegí otra para ajustarla.
            </p>
          )}
          {item.estimateSource === "default" && (
            <p className="text-xs text-subtle-foreground">Por defecto ({fmtMinutes(item.estimateMinutes)}). Lo que elijas se usa para los accionables parecidos.</p>
          )}
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <Button size="sm" disabled={busy} onClick={() => onAction(item, { type: "done" })}>
          <Check /> Marcar hecho
        </Button>
        {item.removable && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction(item, { type: "remove" })}
          >
            <Ban /> No corresponde
          </Button>
        )}
        {item.side === "me_deben" && (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/cuentas/${encodeURIComponent(item.clientId)}?borrador=status`} />}>
            <Mail /> Reclamar
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" nativeButton={false} render={<Link href={`/cuentas/${encodeURIComponent(item.clientId)}`} />}>
          Abrir cuenta <ArrowUpRight />
        </Button>
      </footer>
    </>
  );
}
