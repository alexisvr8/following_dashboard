import { CalendarClock, ExternalLink, Mail } from "lucide-react";
import { daysAgo, formatShortDate } from "@/lib/utils/format";
import type { MailRef } from "@/lib/store/clients-store";

const BADGE = {
  me: { label: "Vos", className: "bg-primary/10 text-primary" },
  team: { label: "Equipo", className: "bg-primary/10 text-primary" },
  client: { label: "Cliente", className: "bg-muted text-foreground" },
};

// Secuencia desde la última reunión: de dónde salen los accionables de abajo.
export function LastChain({
  meeting,
  mails,
}: {
  meeting: { title: string; date: string } | null;
  /** Mails posteriores a la reunión, del más viejo al más nuevo. */
  mails: MailRef[];
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">Última cadena</h4>
      <ol className="space-y-1.5 border-l pl-3">
        {meeting && (
          <li className="flex items-center gap-1.5 text-xs">
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">Reunión: {meeting.title}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {formatShortDate(meeting.date)} · {daysAgo(meeting.date)}
            </span>
          </li>
        )}
        {mails.map((m) => {
          const badge = BADGE[m.direction ?? "client"];
          return (
            <li key={m.messageId} className="text-xs">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="min-w-0 truncate group-hover:text-foreground">
                    {m.direction === "me" ? "" : `${m.fromName ?? m.from}: `}
                    {m.subject}
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {formatShortDate(m.date)} · {daysAgo(m.date)}
                  </span>
                </summary>
                <div className="mt-1.5 space-y-1 rounded-md border border-border bg-surface p-2.5">
                  <p className="whitespace-pre-line text-muted-foreground">{m.excerpt || "Sin texto."}</p>
                  <a
                    href={`https://mail.google.com/mail/#all/${m.threadId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Abrir en Gmail <ExternalLink className="size-3" />
                  </a>
                </div>
              </details>
            </li>
          );
        })}
        {!mails.length && <li className="text-xs text-muted-foreground">Sin mails después de la reunión.</li>}
      </ol>
    </div>
  );
}
