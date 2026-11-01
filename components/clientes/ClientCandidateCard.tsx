"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ClientRecord, ClientStatus } from "@/lib/store/clients-store";

const ACTIONS: { status: ClientStatus; label: string }[] = [
  { status: "assigned", label: "Asignado" },
  { status: "unassigned", label: "No asignado" },
  { status: "ignored", label: "Ignorar" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export function ClientCandidateCard({ client }: { client: ClientRecord }) {
  const router = useRouter();
  const [name, setName] = useState(client.name);
  const [saving, setSaving] = useState(false);
  const latest = client.meetings[0];

  async function patch(body: Partial<Pick<ClientRecord, "status" | "name">>) {
    setSaving(true);
    try {
      await fetch(`/api/clients/${encodeURIComponent(client.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-1 px-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== client.name && patch({ name })}
          className="rounded-sm bg-transparent text-sm font-semibold outline-none focus:ring-2 focus:ring-ring/50"
          aria-label="Nombre de la empresa"
        />
        <span className="text-xs text-muted-foreground">{client.domain}</span>
      </CardHeader>
      <CardContent className="space-y-3 px-4 text-xs">
        <p className="truncate text-muted-foreground" title={client.contactEmails.join(", ")}>
          {client.contactEmails.join(", ")}
        </p>
        <div className="space-y-0.5">
          <p>
            {client.meetings.length} reunión{client.meetings.length === 1 ? "" : "es"}
            {latest && ` · última ${formatDate(latest.date)}`}
          </p>
          {latest && (
            <p className="truncate text-muted-foreground" title={latest.title}>
              {latest.title} · {latest.nextSteps.length} próximos pasos
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map(({ status, label }) => (
            <Button
              key={status}
              size="sm"
              variant={client.status === status ? "default" : "outline"}
              disabled={saving}
              onClick={() => patch({ status: client.status === status ? "pending" : status })}
            >
              {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
