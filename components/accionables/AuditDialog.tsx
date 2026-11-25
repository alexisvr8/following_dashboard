"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, CheckCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AuditAccountView, AuditProposal } from "@/lib/utils/account-audit";
import { fmtShortDate } from "@/components/accionables/format";

// "Auditoría": propuestas de la auditoría única con IA (reuniones + transcripciones + mails + partners vs. tablero).
// Cada una se aplica o se descarta; las preguntas se marcan como vistas. Nada se aplica solo.
// `PATCH /api/clients/[id] {audit: {key, action: "apply"|"dismiss", title?}}` (`resolveAudit`).

const KIND: Record<AuditProposal["kind"], { label: string; tone: "success" | "critical" | "warning" | "outline" }> = {
  done: { label: "Hecho", tone: "success" },
  remove: { label: "Quitar", tone: "critical" },
  side: { label: "Lado", tone: "warning" },
  edit: { label: "Reescribir", tone: "outline" },
  due: { label: "Fecha", tone: "outline" },
  add: { label: "Nuevo", tone: "warning" },
  profile: { label: "Cuenta", tone: "outline" },
  question: { label: "Pregunta", tone: "outline" },
};
const APPLY_LABEL: Partial<Record<AuditProposal["kind"], string>> = { done: "Marcar hecho", remove: "Quitar", add: "Crear", question: "Vista" };
const DEV_LABEL: Record<AuditAccountView["desarrollo"]["quien"], string> = {
  pm: "yo (PM)",
  equipo_xtract: "otro dev de Xtract",
  cliente: "el cliente",
  partner: "un partner",
  mixto: "mixto",
  no_claro: "no claro",
};
const CONF_CLASS = { alta: "text-success", media: "text-warning", baja: "text-critical" } as const;

export function AuditDialog({ accounts, open, onOpenChange }: { accounts: AuditAccountView[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyQuestions, setOnlyQuestions] = useState(false);
  const [showInfo, setShowInfo] = useState(true);

  const visible = useMemo(
    () => accounts.map((a) => ({ ...a, proposals: a.proposals.filter((p) => !resolved.has(p.id)) })).filter((a) => a.proposals.length),
    [accounts, resolved],
  );
  const current = visible.find((a) => a.clientId === selected) ?? visible[0] ?? null;
  const list = current ? current.proposals.filter((p) => (onlyQuestions ? p.kind === "question" : true)) : [];
  const total = visible.reduce((n, a) => n + a.proposals.length, 0);

  async function resolveOne(p: AuditProposal, action: "apply" | "dismiss"): Promise<boolean> {
    const title = drafts[p.id]?.trim();
    setResolved((s) => new Set(s).add(p.id));
    const res = await fetch(`/api/clients/${encodeURIComponent(p.clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audit: { key: p.key, action, ...(action === "apply" && title && { title }) } }),
    }).catch(() => null);
    if (!res?.ok) {
      setResolved((s) => {
        const next = new Set(s);
        next.delete(p.id);
        return next;
      });
      return false;
    }
    return true;
  }

  async function resolve(p: AuditProposal, action: "apply" | "dismiss") {
    setBusy(p.id);
    setError(null);
    if (!(await resolveOne(p, action))) setError("No se pudo guardar. Probá de nuevo.");
    setBusy(null);
    router.refresh();
  }

  async function applyHigh(a: AuditAccountView) {
    const high = a.proposals.filter((p) => p.confianza === "alta" && p.kind !== "question");
    if (!high.length) return;
    setBusy(`all:${a.clientId}`);
    setError(null);
    let failed = 0;
    for (const p of high) if (!(await resolveOne(p, "apply"))) failed++;
    if (failed) setError(`${failed} no se pudieron guardar.`);
    setBusy(null);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Auditoría de cuentas (IA)</DialogTitle>
          <DialogDescription>
            Cruce de las últimas reuniones (con transcripción), todos los mails del período (incluidos partners) y tu
            tablero. Cada cambio trae su evidencia: aplicalo, corregilo antes o descartalo. Las preguntas son lo que la IA
            no pudo afirmar.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-critical">{error}</p>}
        {!current ? (
          <p className="py-6 text-center text-sm text-subtle-foreground">No hay propuestas de auditoría pendientes.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
            <ul className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-y-auto [scrollbar-width:thin]">
              {visible.map((a) => (
                <li key={a.clientId}>
                  <button
                    type="button"
                    onClick={() => setSelected(a.clientId)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs whitespace-nowrap transition-colors",
                      a.clientId === current.clientId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <span className="truncate">{a.clientName}</span>
                    <span className="tabular text-subtle-foreground">
                      {a.proposals.filter((p) => p.kind === "question").length > 0 && `${a.proposals.filter((p) => p.kind === "question").length}? · `}
                      {a.proposals.length}
                    </span>
                  </button>
                </li>
              ))}
              <li className="hidden px-2 pt-2 text-label-sm text-subtle-foreground md:block">{total} pendientes en total</li>
            </ul>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
                <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setShowInfo((v) => !v)}>
                  <span className="font-medium text-foreground">
                    {current.clientName}
                    <span className="ml-2 text-label-sm font-normal text-subtle-foreground">
                      Auditoría {fmtShortDate(current.generatedAt)} · {current.unchanged} vigentes sin cambios
                    </span>
                  </span>
                  <ChevronDown className={cn("size-3.5 text-subtle-foreground transition-transform", showInfo && "rotate-180")} />
                </button>
                {showInfo && (
                  <div className="mt-1.5 space-y-1 text-muted-foreground">
                    <p>{current.resumen}</p>
                    <p className="text-label-sm">
                      <b className="text-foreground">Desarrolla:</b> {DEV_LABEL[current.desarrollo.quien]} — {current.desarrollo.detalle}{" "}
                      <span className={CONF_CLASS[current.desarrollo.confianza]}>({current.desarrollo.confianza})</span> ·{" "}
                      <b className="text-foreground">Tu rol:</b> {current.rolPm}
                      {current.etapa && (
                        <>
                          {" "}
                          · <b className="text-foreground">Etapa:</b> {current.etapa}
                        </>
                      )}
                    </p>
                    <p className="text-label-sm">
                      <b className="text-foreground">Próximo paso:</b> {current.proximoPaso}
                    </p>
                    {current.contactos.length > 0 && (
                      <p className="text-label-sm">
                        <b className="text-foreground">Contactos:</b>{" "}
                        {current.contactos.map((c) => `${c.nombre} (${c.empresa}, ${c.rol}${c.nota ? `: ${c.nota}` : ""})`).join(" · ")}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!!busy || !current.proposals.some((p) => p.confianza === "alta" && p.kind !== "question")}
                    onClick={() => applyHigh(current)}
                    title="Aplica todas las propuestas de confianza alta de esta cuenta (no las preguntas)"
                  >
                    <CheckCheck /> Aplicar confianza alta ({current.proposals.filter((p) => p.confianza === "alta" && p.kind !== "question").length})
                  </Button>
                  <label className="flex items-center gap-1.5 text-label-sm text-muted-foreground">
                    <input type="checkbox" checked={onlyQuestions} onChange={(e) => setOnlyQuestions(e.target.checked)} /> Solo preguntas
                  </label>
                </div>
              </div>

              <ul className="-mx-1 min-h-0 flex-1 divide-y divide-border overflow-y-auto [scrollbar-width:thin]">
                {list.map((p) => {
                  const isBusy = busy === p.id || busy === `all:${p.clientId}`;
                  const k = KIND[p.kind];
                  const editable = p.kind === "edit" || p.kind === "add";
                  return (
                    <li key={p.id} className={cn("space-y-1.5 px-1 py-2.5", isBusy && "opacity-60")}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-sm text-subtle-foreground">
                        <Badge variant={k.tone}>{k.label}</Badge>
                        {p.ref && <Badge variant="outline">{p.ref}</Badge>}
                        {p.kind !== "question" && <span className={CONF_CLASS[p.confianza]}>confianza {p.confianza}</span>}
                        {p.kind === "question" && <span>{p.motivo}</span>}
                      </div>
                      {p.current && (
                        <p className={cn("text-[13px] leading-snug text-subtle-foreground", (p.kind === "edit" || p.kind === "remove" || p.kind === "done") && "line-through decoration-border-strong")}>
                          {p.current}
                        </p>
                      )}
                      {editable ? (
                        <textarea
                          value={drafts[p.id] ?? p.proposal}
                          onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                          rows={2}
                          aria-label="Texto propuesto"
                          className={cn(inputClass, "h-auto min-h-14 w-full resize-y py-1.5 text-[13px] leading-snug")}
                        />
                      ) : (
                        <p className="text-[13px] leading-snug font-medium text-foreground">{p.proposal}</p>
                      )}
                      <p className="text-label-sm text-muted-foreground">
                        {p.evidencia}
                        {p.kind !== "question" && p.motivo && <span className="text-subtle-foreground"> — {p.motivo}</span>}
                      </p>
                      <div className="flex justify-end gap-1.5">
                        <Button size="xs" disabled={isBusy} onClick={() => resolve(p, "apply")}>
                          <Check /> {APPLY_LABEL[p.kind] ?? "Aplicar"}
                        </Button>
                        {p.kind !== "question" && (
                          <Button size="xs" variant="outline" disabled={isBusy} onClick={() => resolve(p, "dismiss")}>
                            <X /> Descartar
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
