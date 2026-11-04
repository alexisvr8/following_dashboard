"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  contactNames: Record<string, string>;
};
type TextField = Exclude<keyof ProfileValues, "contactNames">;

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

// Encabezado de la cuenta con el perfil desplegable: nombre en correos, cómo saludar, ERP, owner y notas.
export function AccountProfileForm({
  clientId,
  initial,
  defaultOwnerEmail,
  contacts,
  header,
  actions,
}: {
  clientId: string;
  initial: ProfileValues;
  defaultOwnerEmail: string | null;
  /** Contactos del lado cliente, con el nombre que se detectó. */
  contacts: { email: string; detectedName: string | null }[];
  header: React.ReactNode;
  actions: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  const set = (k: TextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setState("idle");
  };

  const setContact = (email: string, name: string) => {
    setValues((v) => ({ ...v, contactNames: { ...v.contactNames, [email]: name } }));
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
    <div className="relative shrink-0">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {header}
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="account-profile">
            <Settings2 /> Perfil de la cuenta
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </header>

      {open && (
        <Card id="account-profile" className="absolute inset-x-0 top-full z-30 mt-2 max-h-[calc(100dvh-8rem)] overflow-y-auto shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm">Perfil de la cuenta</CardTitle>
            <p className="text-xs text-muted-foreground">
              Lo que escribas acá se usa en los borradores de mail y como contexto de la cuenta.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Nombre de la cuenta" htmlFor="name">
                  <input id="name" className={inputClass} value={values.name} onChange={set("name")} required />
                </Field>
                <Field label="Nombre en los correos" htmlFor="emailName" hint="Sale en el asunto y en “Hola equipo de…”.">
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
              </div>

              {contacts.length > 0 && (
                <section className="space-y-3">
                  <div>
                    <h4 className="text-xs font-medium">Cómo saludar a cada contacto</h4>
                    <p className="text-[11px] text-muted-foreground">
                      Se usa tal cual: “Hola Virginia,” o “Hola equipo de Calafate,”. Vacío = el nombre detectado; en buzones
                      como cuentas@ o info@, “Hola equipo,”.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {contacts.map((c) => (
                      <div key={c.email} className="space-y-1">
                        <Label htmlFor={`contact-${c.email}`} className="block truncate text-xs font-normal" title={c.email}>
                          {c.email}
                        </Label>
                        <input
                          id={`contact-${c.email}`}
                          className={inputClass}
                          value={values.contactNames[c.email] ?? ""}
                          onChange={(e) => setContact(c.email, e.target.value)}
                          placeholder={c.detectedName ?? "Automático"}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <Field label="Notas" htmlFor="notes">
                <textarea
                  id="notes"
                  rows={3}
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
      )}
    </div>
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
