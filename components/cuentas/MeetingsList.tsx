"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { daysAgo, formatMinutes, formatShortDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { DiscoveredMeeting } from "@/lib/store/clients-store";

// Reuniones con el cliente (más nueva primero). Al elegir una se despliega su minuta: resumen,
// temas, decisiones y accionables definidos (solo lectura; los vigentes se tildan en Accionables).
export function MeetingsList({ meetings }: { meetings: DiscoveredMeeting[] }) {
  const [openId, setOpenId] = useState<string | null>(meetings[0]?.id ?? null);
  if (!meetings.length) {
    return (
      <p className="rounded-lg border border-dashed border-divider p-6 text-center text-sm text-muted-foreground">
        Sin reuniones con minuta.
      </p>
    );
  }
  return (
    <Card size="sm">
      <CardContent>
        <ul className="divide-y divide-row-divider">
          {meetings.map((m) => {
            const open = openId === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : m.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-1 py-2.5 text-left hover:bg-surface"
                >
                  <ChevronRight className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.title}</span>
                    <span className="block truncate text-label-sm text-subtle-foreground">
                      {formatShortDate(m.date)} · {daysAgo(m.date)} · {formatMinutes(m.durationMinutes)} · {m.nextSteps.length} accionables
                      {m.attendees?.length ? ` · ${m.attendees.length} part.` : ""}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="space-y-3 pb-3 pl-6 pr-1 text-xs">
                    <p className="leading-relaxed text-muted-foreground">{m.summary ?? "Sin resumen"}</p>
                    {!!m.milestones?.length && (
                      <Section title="Temas">
                        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {m.milestones.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {!!m.decisions?.length && (
                      <Section title="Decisiones">
                        <ul className="space-y-1">
                          {m.decisions.map((d) => (
                            <li key={d.text} className="flex items-start gap-2 text-muted-foreground">
                              <Badge variant={d.agreed ? "success" : "warning"} className="shrink-0">
                                {d.agreed ? "Acordada" : "Por definir"}
                              </Badge>
                              <span>{d.text}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    <Section title="Accionables definidos">
                      {m.nextSteps.length ? (
                        <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
                          {m.nextSteps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-subtle-foreground">Sin accionables.</p>
                      )}
                    </Section>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-label-sm uppercase text-subtle-foreground">{title}</p>
      {children}
    </div>
  );
}
