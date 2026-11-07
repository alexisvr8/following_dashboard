"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/utils/format";
import type { Participant, ParticipantRole } from "@/lib/utils/participants";

const GROUPS: { role: ParticipantRole; label: string; hint: string }[] = [
  { role: "owner", label: "Owner Xtract", hint: "Responsable de la cuenta" },
  { role: "referent", label: "Referentes", hint: "Dominio coincide con la empresa" },
  { role: "team", label: "Equipo Xtract", hint: "Tu mismo dominio" },
  { role: "external", label: "Otros participantes", hint: "Consultores, partners, otros dominios" },
];

function displayName(p: Participant) {
  if (p.customName) return p.customName;
  if (p.name) return p.name;
  return p.email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function initials(p: Participant) {
  const src = displayName(p);
  return src
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function ParticipantsList({
  clientId,
  participants: initial,
}: {
  clientId: string;
  participants: Participant[];
}) {
  const router = useRouter();
  const [participants, setParticipants] = useState(initial);

  async function toggleReferent(p: Participant) {
    const makeReferent = p.role !== "referent";
    setParticipants((list) =>
      list.map((x) => (x.email === p.email ? { ...x, role: makeReferent ? "referent" : "external", manual: true } : x)),
    );
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { referentOverrides: { [p.email]: makeReferent } } }),
    });
    if (!res.ok) setParticipants((list) => list.map((x) => (x.email === p.email ? p : x)));
    else router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Participantes ({participants.length})</CardTitle>
        <p className="text-xs text-muted-foreground">
          Desde los asistentes de las reuniones. Usa la estrella para marcar o desmarcar referentes.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {GROUPS.map(({ role, label, hint }) => {
          const list = participants.filter((p) => p.role === role);
          if (!list.length) return null;
          return (
            <section key={role} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h4 className="text-xs font-medium">{label}</h4>
                <span className="text-[11px] text-muted-foreground">{hint}</span>
              </div>
              {/* Una fila por participante: nombre y mail completos (envuelven en vez de cortarse). */}
              <ul className="divide-y divide-row-divider overflow-hidden rounded-lg border bg-card">
                {list.map((p) => (
                  <li key={p.email} className="flex items-start gap-2.5 px-2.5 py-2 transition-colors hover:bg-surface">
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        role === "owner" && "bg-primary text-primary-foreground",
                        role === "referent" && "bg-warning-muted text-warning",
                        (role === "team" || role === "external") && "bg-muted text-muted-foreground",
                      )}
                    >
                      {initials(p)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug break-words text-foreground">{displayName(p)}</p>
                      <p className="text-xs leading-snug break-all text-muted-foreground">{p.email}</p>
                      <p className="mt-0.5 text-[11px] text-subtle-foreground">
                        {p.meetingCount
                          ? `${p.meetingCount} ${p.meetingCount === 1 ? "reunión" : "reuniones"} · última ${formatShortDate(p.lastSeenAt!)}`
                          : "Sin asistencia registrada"}
                        {p.manual && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">manual</Badge>}
                      </p>
                    </div>
                    {(role === "referent" || role === "external") && (
                      <button
                        type="button"
                        onClick={() => toggleReferent(p)}
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={role === "referent" ? "Quitar como referente" : "Marcar como referente"}
                        title={role === "referent" ? "Quitar como referente" : "Marcar como referente"}
                      >
                        <Star className={cn("size-4", role === "referent" && "fill-warning text-warning")} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
