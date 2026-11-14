"use client";

import { useState } from "react";
import { DEFAULT_ESTIMATE_GUIDE } from "@/lib/utils/task-kind";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { WorkSettings } from "@/lib/store/settings-store";

const DAYS = [
  { d: 1, label: "L" }, { d: 2, label: "M" }, { d: 3, label: "X" }, { d: 4, label: "J" },
  { d: 5, label: "V" }, { d: 6, label: "S" }, { d: 0, label: "D" },
];

const inputClass =
  "h-9 w-full rounded-md border border-input bg-surface px-3 text-sm outline-none focus-visible:border-ring focus-visible:shadow-highlight";

export function WorkSettingsDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: WorkSettings;
}) {
  const router = useRouter();
  const [v, setV] = useState({ ...settings, aliases: settings.ownerAliases.join(", ") });
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { aliases, ...rest } = v;
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, ownerAliases: aliases.split(",") }),
    });
    setSaving(false);
    if (res.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tu jornada</DialogTitle>
          <DialogDescription>Define tu capacidad y cómo se estiman los accionables.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium">Horario normal</span>
            <div className="grid grid-cols-2 gap-3">
              <TimeField id="cs" label="Arranco" value={v.coreStart} onChange={(x) => setV({ ...v, coreStart: x })} />
              <TimeField id="ce" label="Termino" value={v.coreEnd} onChange={(x) => setV({ ...v, coreEnd: x })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium">Horario flexible (máximo)</span>
            <div className="grid grid-cols-2 gap-3">
              <TimeField id="ws" label="Lo más temprano" value={v.workStart} onChange={(x) => setV({ ...v, workStart: x })} />
              <TimeField id="we" label="Lo más tarde" value={v.workEnd} onChange={(x) => setV({ ...v, workEnd: x })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium">Almuerzo por defecto</span>
            <div className="grid grid-cols-2 gap-3">
              <TimeField id="ls" label="Inicio" value={v.lunchStart} onChange={(x) => setV({ ...v, lunchStart: x })} />
              <div className="space-y-1">
                <Label htmlFor="lunch" className="text-[11px] text-muted-foreground">Duración (min)</Label>
                <input id="lunch" type="number" min={0} max={240} step={15} className={inputClass} value={v.lunchMinutes} onChange={(e) => setV({ ...v, lunchMinutes: Number(e.target.value) })} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Solo para días sin un evento &quot;Almuerzo&quot; en tu Calendar.</p>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium">Días laborales</span>
            <div className="flex gap-1.5">
              {DAYS.map(({ d, label }) => {
                const on = v.workDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setV({ ...v, workDays: on ? v.workDays.filter((x) => x !== d) : [...v.workDays, d] })}
                    className={cn(
                      "size-8 rounded-lg text-xs font-medium transition-colors",
                      on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hpa" className="text-xs">Horas estimadas por accionable</Label>
            <input id="hpa" type="number" min={0} max={40} step={0.25} className={inputClass} value={v.hoursPerActionable} onChange={(e) => setV({ ...v, hoursPerActionable: Number(e.target.value) })} />
            <p className="text-[11px] text-muted-foreground">Las minutas no traen estimación; se usa este promedio.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tus tiempos por tipo de tarea (min)</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["comms", "Mails y seguimiento"],
                  ["review", "Revisar / analizar"],
                  ["config", "Configurar / ajustar"],
                  ["build", "Desarrollo / pruebas"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="space-y-1 text-[11px] text-muted-foreground">
                  {label}
                  <input
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    className={inputClass}
                    value={(v.estimateGuide ?? DEFAULT_ESTIMATE_GUIDE)[k]}
                    onChange={(e) => setV({ ...v, estimateGuide: { ...(v.estimateGuide ?? DEFAULT_ESTIMATE_GUIDE), [k]: Number(e.target.value) } })}
                  />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mails y seguimiento usan este tiempo tal cual; en el resto la IA ajusta entre 0,75× y 1,5× según la complejidad. Lo que corrijas a mano en un accionable manda.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stale" className="text-xs">Alerta sin avances con el cliente (días hábiles)</Label>
            <input id="stale" type="number" min={1} max={15} step={1} className={inputClass} value={v.staleBusinessDays} onChange={(e) => setV({ ...v, staleBusinessDays: Number(e.target.value) })} />
            <p className="text-[11px] text-muted-foreground">Sin mails ni reuniones con la cuenta por este tiempo y con accionables abiertos → alerta + borrador de seguimiento.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aliases" className="text-xs">Tu nombre en las minutas</Label>
            <input id="aliases" className={inputClass} value={v.aliases} onChange={(e) => setV({ ...v, aliases: e.target.value })} placeholder="Alexis Vásquez R, Alexis" />
            <p className="text-[11px] text-muted-foreground">Solo cuentan los accionables &quot;[Tu nombre] …&quot; (separa varios con coma).</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={v.includeGroupTasks} onCheckedChange={(c) => setV({ ...v, includeGroupTasks: c === true })} />
            Contar tareas de &quot;El grupo&quot; como propias
          </label>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">{label}</Label>
      <input id={id} type="time" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
