import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import type { UsageBucket, UsageSummary } from "@/lib/utils/ai-usage-summary";
import type { AICredit } from "@/lib/store/settings-store";
import { AICreditPanel } from "@/components/conexiones/AICreditPanel";

// Consumo de IA en `/conexiones`: costo estimado de hoy / 7 / 30 días, desglose por tipo de llamada, por origen
// y las cuentas que más consumen. Datos del registro `app_state.ai_usage` (ver `lib/store/ai-usage-store.ts`).

const KIND_LABEL: Record<string, { name: string; hint: string }> = {
  postmeeting: { name: "Mail post-reunión", hint: "1 por reunión nueva" },
  status: { name: "Mail de seguimiento", hint: "Al cambiar el contenido · máx. 1 c/3 h por cuenta · modelo barato" },
  analysis: { name: "Análisis semanal", hint: "Lunes 07:00 · 1 por cuenta" },
  reply: { name: "Respuesta al cliente", hint: "Al abrir Responder en el Dashboard · solo si cambió · modelo barato" },
  reminder: { name: "Pedir status", hint: "Al abrir Pedir status · solo si cambió · modelo barato" },
  weekly: { name: "Mail semanal", hint: "Lunes 08:30 · 1 por cuenta con pendientes · modelo barato" },
  audit: { name: "Auditoría de cuentas", hint: "Única, a mano (pnpm audit:accounts) · Opus por Batch API (−50%)" },
};

const TRIGGER_LABEL: Record<string, string> = {
  sync: "Sync automática",
  actualizar: "Botón Actualizar",
  semanal: "Rutina del lunes",
  reanalizar: "Botón Reanalizar",
  preview: "Scripts de prueba",
  responder: "Botón Responder",
  "pedir-status": "Botón Pedir status",
};

const usd = (n: number) => (n > 0 && n < 0.01 ? "< US$ 0,01" : `US$ ${n.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const tokens = (n: number) => n.toLocaleString("es", { notation: "compact", maximumFractionDigits: 1 });
const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const EGRESS_QUOTA = 5 * 1024 ** 3;
const inputTokens = (b: UsageBucket) => b.input + b.cacheRead + b.cacheWrite;

function Figure({ label, bucket }: { label: string; bucket: UsageBucket | undefined }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-surface px-3 py-2.5">
      <p className="text-label-sm uppercase text-subtle-foreground">{label}</p>
      <p className="font-mono text-lg font-medium text-foreground-strong tabular-nums">{usd(bucket?.costUsd ?? 0)}</p>
      <p className="text-xs text-muted-foreground tabular">
        {bucket?.calls ?? 0} llamada{bucket?.calls === 1 ? "" : "s"}
        {bucket?.failed ? <span className="text-critical"> · {bucket.failed} fallida{bucket.failed === 1 ? "" : "s"}</span> : null}
      </p>
    </div>
  );
}

export function AIUsageCard({
  enabled,
  model,
  statusModel,
  credit,
  spent,
  today,
  week,
  month,
  egress,
}: {
  enabled: boolean;
  model: string;
  statusModel: string;
  credit: AICredit | null;
  spent: { costUsd: number; calls: number };
  today: UsageBucket | undefined;
  week: UsageSummary;
  month: UsageSummary;
  egress: { today: number; total: number; requests: number } | null;
}) {
  const kinds = Object.keys(KIND_LABEL);
  const triggers = Object.entries(month.byTrigger).sort((a, b) => b[1].costUsd - a[1].costUsd);
  const topClients = month.byClient.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Consumo de IA (Claude)</CardTitle>
        <CardDescription className="text-xs">
          Post-reunión y análisis <span className="font-mono">{model}</span> · seguimiento <span className="font-mono">{statusModel}</span> · costo estimado con precios de lista
        </CardDescription>
        <CardAction>
          <Badge variant={enabled ? "success" : "outline"}>
            {enabled && <StatusDot tone="success" />}
            {enabled ? "Clave configurada" : "Sin clave (solo reglas)"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <AICreditPanel credit={credit} spent={spent} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Figure label="Hoy" bucket={today} />
          <Figure label="Últimos 7 días" bucket={week.total} />
          <Figure label="Últimos 30 días" bucket={month.total} />
        </div>

        {month.total.calls === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay llamadas registradas en los últimos 30 días. El registro empieza con la próxima llamada a la IA.
          </p>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-label-sm uppercase text-subtle-foreground">Por tipo · 30 días</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-subtle-foreground">
                    <tr className="border-b border-divider">
                      <th className="py-1.5 pr-3 font-normal">Tipo</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Llamadas</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Tokens entrada</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Tokens salida</th>
                      <th className="py-1.5 text-right font-normal">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kinds.map((k) => {
                      const b = month.byKind[k];
                      return (
                        <tr key={k} className="border-b border-row-divider last:border-0">
                          <td className="py-2 pr-3">
                            <p className="text-foreground">{KIND_LABEL[k].name}</p>
                            <p className="text-subtle-foreground">{KIND_LABEL[k].hint}</p>
                          </td>
                          <td className="py-2 pr-3 text-right tabular">
                            {b?.calls ?? 0}
                            {b?.failed ? <span className="text-critical"> ({b.failed} fallidas)</span> : null}
                          </td>
                          <td className="py-2 pr-3 text-right tabular text-muted-foreground">{b ? tokens(inputTokens(b)) : "—"}</td>
                          <td className="py-2 pr-3 text-right tabular text-muted-foreground">{b ? tokens(b.output) : "—"}</td>
                          <td className="py-2 text-right tabular text-foreground-strong">{usd(b?.costUsd ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-label-sm uppercase text-subtle-foreground">Qué lo disparó · 30 días</h3>
                <ul className="space-y-1.5 text-xs">
                  {triggers.map(([t, b]) => (
                    <li key={t} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{TRIGGER_LABEL[t] ?? t}</span>
                      <span className="tabular">
                        <span className="text-subtle-foreground">{b.calls} · </span>
                        {usd(b.costUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-label-sm uppercase text-subtle-foreground">Cuentas que más consumen · 30 días</h3>
                <ul className="space-y-1.5 text-xs">
                  {topClients.map((c) => (
                    <li key={c.name} className="flex items-center justify-between gap-3">
                      <span className="truncate text-muted-foreground">{c.name}</span>
                      <span className="shrink-0 tabular">
                        <span className="text-subtle-foreground">{c.calls} · </span>
                        {usd(c.costUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}

        <p className="text-xs text-subtle-foreground">
          Estimación propia: la factura real está en{" "}
          <a href="https://console.anthropic.com/settings/usage" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            console.anthropic.com
          </a>
          . Detalle completo en <span className="font-mono">/api/ai-usage</span>.
        </p>
        {egress && (
          <p className="text-xs text-subtle-foreground tabular" title="Bytes que bajó esta app de Supabase (aprox., sin comprimir: cota superior). La cifra oficial está en Supabase → Usage.">
            Lectura Supabase · hoy {mb(egress.today)} · 30 días{" "}
            <span className={egress.total > EGRESS_QUOTA * 0.8 ? "text-critical" : "text-foreground"}>{mb(egress.total)}</span> de 5 GB (
            {Math.round((egress.total / EGRESS_QUOTA) * 100)}%) · {egress.requests.toLocaleString("es")} consultas
          </p>
        )}
      </CardContent>
    </Card>
  );
}
