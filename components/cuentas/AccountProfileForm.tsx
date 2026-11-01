"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const ERP_SUGGESTIONS = [
  "SAP Business One", "SAP S/4HANA", "Tango Gestión", "Bejerman", "Flexus", "Finnegans",
  "Neuralsoft", "Odoo", "Microsoft Dynamics", "Oracle NetSuite", "Protheus (TOTVS)", "Calipso",
];

type ProfileValues = {
  name: string;
  emailName: string;
  erp: string;
  ownerEmail: string;
  notes: string;
};

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Contexto de la cuenta para el futuro agente: nombre en correos, ERP, owner y notas.
export function AccountProfileForm({
  clientId,
  initial,
  defaultOwnerEmail,
}: {
  clientId: string;
  initial: ProfileValues;
  defaultOwnerEmail: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = (Object.keys(values) as (keyof ProfileValues)[]).some((k) => values[k] !== saved[k]);

  const set = (k: keyof ProfileValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setState("idle");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!values.name.trim()) return;
    setState("saving");
    const { name, ...profile } = values;
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, profile }),
    });
    if (!res.ok) return setState("error");
    setSaved(values);
    setState("saved");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Perfil de la cuenta</CardTitle>
        <p className="text-xs text-muted-foreground">
          Contexto que usará el agente para redactar correos y leer minutas.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <Field label="Nombre de la cuenta" htmlFor="name">
            <input id="name" className={inputClass} value={values.name} onChange={set("name")} required />
          </Field>
          <Field label="Nombre en los correos" htmlFor="emailName" hint="Razón social o cómo se los nombra por mail.">
            <input id="emailName" className={inputClass} value={values.emailName} onChange={set("emailName")} placeholder={`p. ej. ${initial.name} S.A.`} />
          </Field>
          <Field label="ERP" htmlFor="erp">
            <input id="erp" list="erp-options" className={inputClass} value={values.erp} onChange={set("erp")} placeholder="SAP, Tango, Flexus…" />
            <datalist id="erp-options">
              {ERP_SUGGESTIONS.map((e) => <option key={e} value={e} />)}
            </datalist>
          </Field>
          <Field label="Owner Xtract" htmlFor="ownerEmail" hint={defaultOwnerEmail ? `Por defecto: ${defaultOwnerEmail}` : "Se completa al re-escanear en Clientes."}>
            <input id="ownerEmail" type="email" className={inputClass} value={values.ownerEmail} onChange={set("ownerEmail")} placeholder={defaultOwnerEmail ?? "tu@xtract.com"} />
          </Field>
          <Field label="Notas para el agente" htmlFor="notes">
            <textarea
              id="notes"
              rows={4}
              className={`${inputClass} h-auto resize-y py-2`}
              value={values.notes}
              onChange={set("notes")}
              placeholder="Particularidades, módulos que usan, tono de los correos…"
            />
          </Field>
          <div className="flex items-center justify-end gap-3">
            {state === "saved" && !dirty && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" /> Guardado
              </span>
            )}
            {state === "error" && <span className="text-xs text-destructive">No se pudo guardar</span>}
            <Button type="submit" disabled={!dirty || state === "saving"}>
              {state === "saving" && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
