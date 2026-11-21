"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { BellRing, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type MailKindChoice = "general" | "reminder";

type Ctx = {
  choice: MailKindChoice;
  setChoice: (c: MailKindChoice) => void;
  generalLabel: string;
  reminderCount: number;
  /** Modo expandido compartido: al cambiar de tipo con el modal abierto, se abre el del otro mail. */
  expanded?: boolean;
  setExpanded?: (e: boolean) => void;
  /** Dónde dibuja su editor el mail elegido cuando está expandido (el modal compartido). */
  portal?: HTMLElement | null;
};
const MailKindContext = createContext<Ctx | null>(null);

/** Provee el selector General | Pedir status a los `FollowupComposer` de adentro (lo dibujan en su encabezado). */
export function MailKindProvider({
  value,
  enabled = true,
  children,
}: {
  value: Ctx;
  /** false = sin selector (p. ej. recordatorio de un solo punto). */
  enabled?: boolean;
  children: ReactNode;
}) {
  return <MailKindContext.Provider value={enabled ? value : null}>{children}</MailKindContext.Provider>;
}

/** Contexto del selector (para que el composer sepa si es el mail elegido y comparta el modo expandido). */
export const useMailKind = () => useContext(MailKindContext);

/** Selector compacto del tipo de mail; no dibuja nada fuera de un `MailKindProvider`. */
export function MailKindToggle({ className }: { className?: string }) {
  const ctx = useContext(MailKindContext);
  if (!ctx) return null;
  const options: [MailKindChoice, string, typeof Mail, string][] = [
    ["general", ctx.generalLabel, Mail, "Avances, lo que está en curso y lo pendiente de cada lado"],
    [
      "reminder",
      `Pedir status${ctx.reminderCount ? ` (${ctx.reminderCount})` : ""}`,
      BellRing,
      ctx.reminderCount
        ? "Recordatorio corto y amigable de los puntos en Seguimiento (los que tiene el cliente)"
        : "No hay puntos en Seguimiento del lado del cliente",
    ],
  ];
  return (
    <div className={cn("flex shrink-0 rounded-md border border-input bg-surface p-0.5", className)} role="group" aria-label="Tipo de mail">
      {options.map(([key, label, Icon, title]) => (
        <button
          key={key}
          type="button"
          title={title}
          aria-pressed={ctx.choice === key}
          onClick={() => ctx.setChoice(key)}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs whitespace-nowrap transition-colors",
            ctx.choice === key ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// Tipo de mail de la cuenta: seguimiento general (minuta hasta que sale, después avances + pendientes) o un
// recordatorio corto pidiendo status de lo que está en Seguimiento (me deben). El selector va en el encabezado
// de cada editor (`MailKindToggle`); los dos quedan montados para no perder lo que estés escribiendo al cambiar.
export function MailKindSwitch({
  general,
  reminder,
  generalLabel,
  reminderCount,
  className,
}: {
  general: ReactNode;
  reminder: ReactNode | null;
  generalLabel: string;
  reminderCount: number;
  className?: string;
}) {
  const [choice, setChoice] = useState<MailKindChoice>("general");
  const [expanded, setExpanded] = useState(false);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const body = (
    <div className={className}>
      <div className={cn(choice !== "general" && "hidden")}>{general}</div>
      {reminder && <div className={cn(choice !== "reminder" && "hidden")}>{reminder}</div>}
    </div>
  );
  if (!reminder) return body;
  return (
    <MailKindProvider value={{ choice, setChoice, generalLabel, reminderCount, expanded, setExpanded, portal }}>
      {body}
      {/* Modal expandido compartido: queda abierto al cambiar de tipo; adentro se dibuja el mail elegido. */}
      <Dialog open={expanded} onOpenChange={(o) => !o && setExpanded(false)}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[94dvh] w-[min(80rem,calc(100%-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">Mail de la cuenta</DialogTitle>
          <div ref={setPortal} className="flex min-h-0 flex-1 flex-col" />
        </DialogContent>
      </Dialog>
    </MailKindProvider>
  );
}
