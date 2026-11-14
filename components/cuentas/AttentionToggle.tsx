"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// "Más atención" (cliente exigente, `profile.attention`): sus accionables van primero y en prioridad alta, con
// meta interna de 1 día hábil, alerta de Seguimiento al primer día hábil sin novedades y la IA lo tiene en cuenta.

export function AttentionBadge({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <Badge variant="warning" title="Cuenta de más atención: lo suyo va primero" className={cn(size === "sm" && "px-1.5 text-[10.5px]", className)}>
      <Flame className="size-3" /> {size === "sm" ? "Atención" : "Más atención"}
    </Badge>
  );
}

export function AttentionToggle({ clientId, initial }: { clientId: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    setOn(next);
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { attention: next } }),
    }).catch(() => null);
    if (!res?.ok) setOn(!next);
    setBusy(false);
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={
        on
          ? "Quitar “Más atención”"
          : "Cliente exigente: sus accionables van primero (prioridad alta, meta 1 día hábil) y alerta al primer día sin novedades"
      }
      className={cn(on && "border-warning/40 bg-warning-muted text-warning hover:bg-warning-muted hover:text-warning")}
    >
      <Flame /> {on ? "Más atención" : "Marcar más atención"}
    </Button>
  );
}
