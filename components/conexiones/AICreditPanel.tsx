"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import type { AICredit } from "@/lib/store/settings-store";

// Saldo de la API en la tarjeta de Consumo de IA. La API de Anthropic no expone el saldo: se carga a mano el que
// muestra la consola y se le descuenta lo registrado desde ese momento (estimado con precios de lista).

const usd = (n: number) => `US$ ${n.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** El registro de consumo guarda 120 días: más atrás el descuento se queda corto. */
const KEEP_DAYS = 120;

export function AICreditPanel({ credit, spent }: { credit: AICredit | null; spent: { costUsd: number; calls: number } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!credit);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const save = async () => {
    const amount = Number(value.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) return setError("Monto inválido");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aiCredit: { amountUsd: amount } }),
      });
      if (!res.ok) throw new Error();
      setEditing(false);
      setValue("");
      router.refresh();
    } catch {
      setError("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const balance = credit ? credit.amountUsd - spent.costUsd : null;
  const tone = balance === null ? "text-foreground-strong" : balance < 0 ? "text-critical" : balance < 5 ? "text-warning" : "text-foreground-strong";
  const stale = credit && now - Date.parse(credit.since) > KEEP_DAYS * 86_400_000;

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-label-sm uppercase text-subtle-foreground">Saldo estimado</p>
          {balance !== null ? (
            <p className={`font-mono text-lg font-medium tabular-nums ${tone}`}>{usd(balance)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin saldo cargado</p>
          )}
          {credit && (
            <p className="text-xs text-muted-foreground tabular">
              {usd(credit.amountUsd)} el {new Date(credit.since).toLocaleDateString("es", { day: "2-digit", month: "2-digit" })} − {usd(spent.costUsd)} en{" "}
              {spent.calls} llamada{spent.calls === 1 ? "" : "s"}
            </p>
          )}
          {stale && <p className="text-xs text-warning">Cargado hace más de {KEEP_DAYS} días: actualizalo para que el descuento sea completo.</p>}
        </div>
        {!editing && (
          <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
            Actualizar saldo
          </Button>
        )}
      </div>
      {editing && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Pegá el saldo que ves hoy en la consola (Billing); desde ahora se le descuenta lo que gaste la app.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} h-7 w-32 font-mono`}
              inputMode="decimal"
              placeholder="US$ 0,00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              aria-label="Saldo en US$"
            />
            <Button size="xs" onClick={() => void save()} disabled={saving || !value.trim()}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
            {credit && (
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </Button>
            )}
            <a
              href="https://console.anthropic.com/settings/billing"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-subtle-foreground underline underline-offset-2 hover:text-foreground"
            >
              Abrir Billing
            </a>
          </div>
          {error && <p className="text-xs text-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}
