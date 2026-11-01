"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientCandidateCard } from "@/components/clientes/ClientCandidateCard";
import type { ClientsFile, ClientStatus } from "@/lib/store/clients-store";

const TABS: { status: ClientStatus; label: string }[] = [
  { status: "pending", label: "Por validar" },
  { status: "assigned", label: "Asignados" },
  { status: "unassigned", label: "No asignados" },
  { status: "ignored", label: "Ignorados" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short" });
}

export function ClientsReview({ file }: { file: ClientsFile }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/clients/discover?days=60", { method: "POST" });
      const data = await res.json();
      setMessage(
        res.ok
          ? `${data.scanned} minutas (${data.skipped} ya procesadas) · ${data.newClients} clientes nuevos · ${data.unmatched} sin cliente${data.failed ? ` · ${data.failed} con error (reintentar)` : ""}`
          : data.error === "google_not_connected"
            ? "Google no está conectado. Conéctalo desde Conexiones."
            : `Error: ${data.error}`,
      );
      router.refresh();
    } finally {
      setScanning(false);
    }
  }

  async function syncActivity() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/clients/sync-activity", { method: "POST" });
      const data = await res.json();
      setMessage(
        res.ok
          ? `${data.synced} cuentas actualizadas · ${data.withMail} con mail real de referentes · ${data.followupsDetected} follow-ups ya enviados${data.failed ? ` · ${data.failed} con error (reintentar)` : ""}`
          : data.error === "google_not_connected"
            ? "Google no está conectado. Conéctalo desde Conexiones."
            : `Error: ${data.error}`,
      );
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  // Clientes con reunión más reciente primero.
  const sorted = [...file.clients].sort((a, b) =>
    (b.meetings[0]?.date ?? "").localeCompare(a.meetings[0]?.date ?? ""),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={scan} disabled={scanning}>
          <RefreshCw className={scanning ? "animate-spin" : undefined} />
          {scanning ? "Escaneando…" : "Escanear Gemini Notes (60 días)"}
        </Button>
        <Button variant="outline" onClick={syncActivity} disabled={syncing || scanning}>
          <MailCheck className={syncing ? "animate-pulse" : undefined} />
          {syncing ? "Actualizando…" : "Actualizar mails y reuniones (asignados + no asignados)"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {file.lastScanAt
            ? `Último escaneo: ${new Date(file.lastScanAt).toLocaleString("es")}`
            : "Nunca escaneado"}
        </span>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Tabs defaultValue="pending">
        <TabsList>
          {TABS.map(({ status, label }) => (
            <TabsTrigger key={status} value={status}>
              {label} ({file.clients.filter((c) => c.status === status).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(({ status }) => {
          const clients = sorted.filter((c) => c.status === status);
          return (
            <TabsContent key={status} value={status}>
              {clients.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {clients.map((client) => (
                    <ClientCandidateCard key={client.id} client={client} />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-sm text-muted-foreground">No hay clientes en esta lista.</p>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {file.unmatched.length > 0 && (
        <details className="rounded-lg border p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Reuniones sin cliente detectado ({file.unmatched.length})
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Sin evento de Calendar asociado o sin asistentes externos a tu dominio.
          </p>
          <ul className="mt-3 space-y-1">
            {file.unmatched.map((m) => (
              <li key={m.id} className="flex justify-between gap-4">
                <span className="truncate">{m.title}</span>
                <span className="shrink-0 text-muted-foreground">{formatDate(m.date)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
