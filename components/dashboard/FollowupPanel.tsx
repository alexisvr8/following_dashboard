"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FollowupComposer } from "@/components/cuentas/FollowupComposer";
import type { FollowupDraft, MailRef, ThreadRef } from "@/lib/store/clients-store";
import type { ThreadMessage } from "@/lib/integrations/client-activity";
import type { AccountAlert } from "@/lib/utils/followup-alerts";
import { cn } from "@/lib/utils";

export type FollowupPanelData = {
  meetingTitle: string;
  draft: { draft: FollowupDraft; generated: FollowupDraft; regenerated: boolean; lastSentAt: string | null };
  threads: ThreadRef[];
  lastMail: MailRef | null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

// Cuadro centrado de respuesta inline: hilo del último mail (izq.) + editor del borrador de
// actualización (der.), con el mismo FollowupComposer y endpoints que /cuentas. Click afuera o Esc
// lo cierra y vuelve al Dashboard.
export function FollowupPanel({
  alert,
  data,
  open,
  onOpenChange,
}: {
  alert: AccountAlert;
  data: FollowupPanelData | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[min(78rem,calc(100%-2rem))] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <div className="shrink-0 border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="text-foreground-strong">{alert.name}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            Último movimiento: {alert.lastMovementLabel} ·{" "}
            <span className="tabular">
              {alert.businessDays} día{alert.businessDays === 1 ? "" : "s"} háb.
            </span>{" "}
            ·{" "}
            <Link
              href={`/cuentas/${encodeURIComponent(alert.clientId)}?borrador=status#borradores`}
              className="inline-flex items-center gap-1 font-medium text-foreground-strong no-underline hover:underline"
            >
              Abrir cuenta <ArrowRight className="size-3" />
            </Link>
          </DialogDescription>
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] md:overflow-hidden">
          <div className="min-w-0 min-h-0 overflow-x-hidden border-border p-4 md:overflow-y-auto md:border-r [scrollbar-width:thin]">
            {open && <ThreadView clientId={alert.clientId} mail={data?.lastMail ?? null} />}
          </div>
          <div className="min-h-0 p-4 md:overflow-y-auto [scrollbar-width:thin]">
            {data ? (
              <FollowupComposer
                key={data.draft.draft.meetingId}
                kind="status"
                showTitle
                className="border-0 bg-transparent py-0 lg:h-auto [--card-spacing:0px]"
                bodyMaxClass="max-h-[calc(88dvh-24rem)]"
                clientId={alert.clientId}
                title="Respuesta / actualización"
                hint={
                  data.draft.regenerated
                    ? `Regenerado con los mails y accionables nuevos, a partir de “${data.meetingTitle}”.`
                    : `Generado con lo finalizado y lo pendiente desde la última interacción (“${data.meetingTitle}”).`
                }
                lastSentAt={data.draft.lastSentAt}
                initial={data.draft.draft}
                generated={data.draft.generated}
                threads={data.threads}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-divider p-4 text-center text-xs text-muted-foreground">
                Esta cuenta no tiene reuniones con minuta: todavía no hay borrador.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadView({ clientId, mail }: { clientId: string; mail: MailRef | null }) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadId = mail?.threadId;

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    fetch(`/api/clients/${encodeURIComponent(clientId)}/thread/${encodeURIComponent(threadId)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error === "google_not_connected" ? "Google no está conectado." : "No se pudo leer el hilo.");
        else setMessages(body.messages);
      })
      .catch(() => !cancelled && setError("No se pudo leer el hilo."));
    return () => {
      cancelled = true;
    };
  }, [clientId, threadId]);

  if (!mail) {
    return (
      <p className="rounded-lg border border-dashed border-divider p-4 text-center text-xs text-muted-foreground">
        Sin mails sincronizados con esta cuenta.
      </p>
    );
  }

  // Mientras carga (o si falla) se muestra el extracto que ya está sincronizado.
  // Más nuevo primero: en hilos largos lo que hay que responder queda arriba.
  const list: ThreadMessage[] = messages ? [...messages].reverse() : [
    {
      messageId: mail.messageId,
      from: mail.from,
      fromName: mail.fromName,
      to: mail.recipients ?? [],
      subject: mail.subject,
      date: mail.date,
      text: mail.excerpt,
    },
  ];

  return (
    <section className="shrink-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-label-sm uppercase text-subtle-foreground">
          Hilo del último mail{messages && ` · ${messages.length} mensaje${messages.length === 1 ? "" : "s"}, más nuevo primero`}
        </h3>
        {!messages && !error && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="truncate text-sm font-medium text-foreground-strong" title={mail.subject}>
        {mail.subject}
      </p>
      {error && <p className="text-xs text-warning">{error} Se muestra el extracto guardado.</p>}
      <ol className="min-w-0 space-y-2">
        {list.map((m, i) => (
          <li
            key={m.messageId}
            className={cn("min-w-0 rounded-lg border bg-surface p-3", i === 0 ? "border-border-strong" : "border-border")}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="min-w-0 truncate text-xs font-medium">
                {m.fromName ?? m.from}
                {m.fromName && <span className="ml-1 font-normal text-subtle-foreground">{m.from}</span>}
              </p>
              <time className="shrink-0 text-label-sm text-subtle-foreground" dateTime={m.date}>
                {fmtDate(m.date)}
              </time>
            </div>
            {!!m.to.length && <p className="truncate text-[11px] text-subtle-foreground">Para: {m.to.join(", ")}</p>}
            <p className="mt-2 whitespace-pre-line text-xs leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">{m.text || "(sin texto)"}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
