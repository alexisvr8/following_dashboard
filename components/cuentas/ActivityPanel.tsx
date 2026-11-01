"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Link2, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { daysAgo, formatShortDate } from "@/lib/utils/format";
import type { ClientActivity } from "@/lib/store/clients-store";

// Trazabilidad: último mail real de referentes (sin invitaciones/auto-respuestas/minutas),
// relación con los accionables y validación de la última reunión contra Calendar.
export function ActivityPanel({
  clientId,
  activity,
  latestMinutesDate,
  ticketTitles,
}: {
  clientId: string;
  activity: ClientActivity | null;
  latestMinutesDate: string | null;
  ticketTitles: Record<string, string>;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/clients/sync-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [clientId] }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error === "google_not_connected" ? "Google no está conectado." : data.error);
      else if (data.failed) setError(data.errors?.[0]?.error ?? "Error al sincronizar");
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  const cal = activity?.lastCalendarMeeting;
  const missingNotes = cal && !cal.hasNotes && (!latestMinutesDate || cal.date > latestMinutesDate);
  const mail = activity?.lastMail ?? activity?.lastInboundMail;
  const clientMail = activity?.lastInboundMail;
  const recent = activity?.recentMails ?? activity?.recentInbound ?? [];
  const skipped = activity ? activity.skipped.invitation + activity.skipped.autoReply + activity.skipped.minutes : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-sm">Trazabilidad</CardTitle>
          <p className="text-xs text-muted-foreground">
            {activity ? `Actualizado ${new Date(activity.syncedAt).toLocaleString("es")}` : "Sin sincronizar"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
          <RefreshCw className={syncing ? "animate-spin" : undefined} />
          {syncing ? "Actualizando…" : "Actualizar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <p className="text-xs text-destructive">{error}</p>}

        {missingNotes && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <p>
              La última reunión en Calendar (<b>{cal.title}</b>, {formatShortDate(cal.date)}) no tiene minuta de
              Gemini. Los accionables mostrados son de la minuta anterior.
            </p>
          </div>
        )}

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Último mail de la cuenta</h4>
          {mail ? (
            <MailItem mail={mail} ticketTitles={ticketTitles} highlight />
          ) : (
            <p className="text-xs text-muted-foreground">
              {activity ? "Sin mails reales con la cuenta en los últimos 180 días." : "Tocá Actualizar para buscar."}
            </p>
          )}
          {clientMail && mail && clientMail.messageId !== mail.messageId && (
            <>
              <h4 className="pt-1 text-xs font-medium text-muted-foreground">Último mail del cliente</h4>
              <MailItem mail={clientMail} ticketTitles={ticketTitles} />
            </>
          )}
          {activity && skipped > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Descartados: {activity.skipped.invitation} de Calendar · {activity.skipped.autoReply} auto-respuestas ·{" "}
              {activity.skipped.minutes} minutas
            </p>
          )}
        </section>

        {recent.length > 1 && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Mails anteriores ({recent.length - 1})
            </summary>
            <div className="mt-2 space-y-2">
              {recent.slice(1).map((m) => (
                <MailItem key={m.messageId} mail={m} ticketTitles={ticketTitles} />
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function MailItem({
  mail,
  ticketTitles,
  highlight,
}: {
  mail: ClientActivity["recentInbound"][number];
  ticketTitles: Record<string, string>;
  highlight?: boolean;
}) {
  const related = mail.relatedTicketIds.map((id) => ticketTitles[id]).filter(Boolean);
  const mine = mail.direction === "me" || mail.direction === "team";
  const badge = mail.direction === "me" ? "Vos" : mail.direction === "team" ? "Equipo" : "Cliente";
  return (
    <div className={`space-y-1.5 rounded-md border p-3 ${highlight ? "" : "bg-muted/30"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium">
            <Mail className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${mine ? "bg-primary/10 text-primary" : "bg-muted text-foreground"}`}>
              {badge}
            </span>
            <span className="truncate">{mail.subject}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {mail.fromName ? `${mail.fromName} · ` : ""}
            {mail.from} · {formatShortDate(mail.date)} ({daysAgo(mail.date)})
          </p>
        </div>
        <a
          href={`https://mail.google.com/mail/#all/${mail.threadId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Abrir en Gmail"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      {highlight && mail.excerpt && (
        <p className="line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{mail.excerpt}</p>
      )}
      {related.length > 0 ? (
        <ul className="space-y-0.5">
          {related.map((t) => (
            <li key={t} className="flex gap-1 text-[11px] text-primary">
              <Link2 className="mt-0.5 size-3 shrink-0" /> {mine ? "Posiblemente resuelto: " : "Menciona: "}
              {t}
            </li>
          ))}
        </ul>
      ) : (
        highlight && <p className="text-[11px] text-muted-foreground">No parece tratar accionables de la última reunión.</p>
      )}
      {!!mail.requests?.length && (
        <div className="space-y-0.5">
          <p className="text-[11px] font-medium">Pedidos detectados (→ accionables tuyos):</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {mail.requests.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
