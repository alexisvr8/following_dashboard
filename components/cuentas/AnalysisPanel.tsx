"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Mail, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AnalysisView } from "@/lib/utils/account-analysis";

// Pestaña "Análisis IA" de la cuenta: estado, resumen, plan de la semana (con lo NUEVO que la IA sumó al
// tablero), posibles resueltos para tildar, conversaciones por hilo, riesgos y qué decir en el próximo mail.
// Reanalizar = `POST /api/analysis {ids, force}` (~50 s, ~US$ 0,15).

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
const LEVEL: Record<string, "critical" | "warning" | "secondary"> = { alta: "critical", media: "warning", baja: "secondary" };
const CONV: Record<string, string> = {
  espera_mi_respuesta: "Espera mi respuesta",
  espera_cliente: "Espera al cliente",
  en_curso: "En curso",
  resuelto: "Resuelto",
  informativo: "Informativo",
};

export function AnalysisPanel({ clientId, view }: { clientId: string; view: AnalysisView | null }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  async function rerun() {
    setRunning(true);
    setError(null);
    const res = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [clientId], force: true }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || data?.failed) setError(data?.accounts?.[0]?.error ?? data?.error ?? "No se pudo analizar");
    setRunning(false);
    router.refresh();
  }

  async function tick(ticketId: string) {
    setTicked((s) => new Set(s).add(ticketId));
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId, isDone: true }),
    }).catch(() => null);
    if (!res?.ok) setTicked((s) => new Set([...s].filter((x) => x !== ticketId)));
    router.refresh();
  }

  const rerunButton = (
    <Button size="sm" variant="outline" onClick={rerun} disabled={running}>
      {running ? <Loader2 className="animate-spin" /> : <RefreshCw />} {running ? "Analizando… (~1 min)" : view ? "Reanalizar" : "Analizar ahora"}
    </Button>
  );

  if (!view) {
    return (
      <Card size="sm">
        <CardContent className="space-y-3 py-6 text-center text-sm text-muted-foreground">
          <p>Todavía no hay análisis con IA de esta cuenta.</p>
          {rerunButton}
          {error && <p className="text-xs text-critical">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const newCount = view.plan.filter((p) => !p.ref).length;
  return (
    <div className="space-y-3">
      <Card size="sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-3.5" /> Análisis IA
          </CardTitle>
          {rerunButton}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={view.state === "en_riesgo" || view.state === "bloqueada" ? "critical" : view.state === "avanzando" ? "success" : "outline"}>
              {view.stateLabel}
            </Badge>
            <Badge variant={LEVEL[view.priority.nivel] ?? "outline"}>Prioridad sugerida {view.priority.nivel}</Badge>
            <span className="text-label-sm text-subtle-foreground">
              {fmt(view.generatedAt)} · base {view.basis === "reunion" ? "reunión" : "mails"} · {view.threadsRead} hilos / {view.mailsRead} mails
              {view.truncated && " (truncado)"}
            </span>
          </div>
          {view.stale && (
            <p className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-muted px-2 py-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0" /> Hubo una reunión o un mail del cliente después del análisis: conviene reanalizar.
            </p>
          )}
          {error && <p className="text-xs text-critical">{error}</p>}
          <p className="text-[13px] leading-relaxed text-foreground">{view.resumen}</p>
          <p className="text-xs text-muted-foreground">
            Última interacción ({view.lastInteraction.fecha}): {view.lastInteraction.resumen}
          </p>
          <p className="text-xs text-muted-foreground">Prioridad: {view.priority.motivo}</p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Mail className="size-3.5" /> Próximo mail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] leading-relaxed text-foreground">{view.nextMail}</p>
        </CardContent>
      </Card>

      {view.resolved.some((r) => !r.done) && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Posibles resueltos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {view.resolved
                .filter((r) => !r.done)
                .map((r) => (
                  <li key={r.ref} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-foreground">{r.title}</p>
                      <p className="text-label-sm text-muted-foreground">{r.evidencia}</p>
                    </div>
                    <Button size="xs" variant="outline" disabled={ticked.has(r.ticketId)} onClick={() => tick(r.ticketId)}>
                      <Check /> Hecho
                    </Button>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">
            Plan de la semana{newCount > 0 && <span className="ml-1.5 font-normal text-muted-foreground">· {newCount} nuevos sumados al tablero</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-row-divider">
            {view.plan.map((p, i) => (
              <li key={`${p.ref ?? "n"}-${i}`} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.ref ? <span className="tabular text-label-sm text-subtle-foreground">{p.ref}</span> : <Badge variant="secondary">Nuevo</Badge>}
                  <span className="text-[13px] font-medium text-foreground-strong">{p.titulo}</span>
                  <Badge variant="outline">{p.lado === "debo" ? "Debo" : "Me deben"}</Badge>
                  <Badge variant={LEVEL[p.prioridad] ?? "outline"}>{p.prioridad}</Badge>
                  {p.fecha && <span className="tabular text-label-sm text-muted-foreground">{p.fecha}</span>}
                </div>
                <p className="text-xs leading-snug text-muted-foreground">{p.descripcion}</p>
                <p className="text-label-sm text-subtle-foreground">
                  {p.responsable && `${p.responsable} · `}
                  {p.evidencia}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {view.risks.length > 0 && <ListCard title="Riesgos" items={view.risks} tone="warning" />}

      {view.conversations.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Conversaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {view.conversations.map((c, i) => (
                <li key={i} className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="tabular text-label-sm text-subtle-foreground">{c.fecha}</span>
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{c.asunto}</span>
                    <Badge variant={c.estado === "espera_mi_respuesta" ? "critical" : "outline"}>{CONV[c.estado] ?? c.estado}</Badge>
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">{c.tema}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {view.review.length > 0 && <ListCard title="Para revisar" items={view.review} />}
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone?: "warning" }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className={cn("text-sm", tone === "warning" && "text-warning")}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-4 text-xs leading-snug text-muted-foreground">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
