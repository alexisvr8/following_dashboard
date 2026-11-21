"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, MailX, RefreshCw, Reply, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { UnassignedMail } from "@/lib/store/unassigned-mail-store";

type Link = "thread" | "sender" | "domain";
type Ignore = "" | "sender" | "domain";

const fmt = (iso: string) => new Date(iso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Capa C: mails externos dirigidos a ti (15 días) que la sync no pudo asignar. Cada uno con sugerencias por reglas;
// asignar liga el hilo a la cuenta (y opcionalmente el remitente/dominio como Exclusivo); descartar no vuelve.
export function UnassignedMails({
  items,
  accounts,
  scannedAt,
}: {
  items: UnassignedMail[];
  accounts: { id: string; name: string }[];
  scannedAt: string | null;
}) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: unknown) {
    setError(null);
    try {
      const res = await fetch("/api/unassigned-mails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error === "google_not_connected" ? "Google no está conectado." : "No se pudo completar. Reintenta.");
      router.refresh();
      return res.ok;
    } catch {
      setError("Sin conexión con el servidor. Reintenta en un momento.");
      return false;
    }
  }

  async function scan() {
    setScanning(true);
    await post({ action: "scan" });
    setScanning(false);
  }

  async function act(threadId: string, body: Record<string, unknown>) {
    setBusy(threadId);
    await post({ ...body, threadId });
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={scan} disabled={scanning}>
          <RefreshCw className={scanning ? "animate-spin" : undefined} /> {scanning ? "Buscando…" : "Buscar ahora (15 días)"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {scannedAt ? `Última búsqueda: ${new Date(scannedAt).toLocaleString("es")} · la sync la repite cada 30 min` : "Todavía no se buscó"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Mails de afuera dirigidos a ti (Para o Cc) que no son de ninguna cuenta: partners o desarrolladores externos sin el
        cliente en el hilo, remitentes nuevos… Solo los de remitentes que te escriben seguido, a los que respondiste o con una
        pista de cuenta. Nunca se asignan solos.
      </p>
      {error && <p className="rounded-md border border-critical/25 bg-critical-muted px-3 py-1.5 text-xs text-foreground">{error}</p>}

      {items.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((m) => (
            <MailCard key={m.threadId} mail={m} accounts={accounts} busy={busy === m.threadId} onAct={(b) => act(m.threadId, b)} />
          ))}
        </ul>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">No hay mails sin cuenta en los últimos 15 días.</p>
      )}
    </div>
  );
}

function MailCard({
  mail,
  accounts,
  busy,
  onAct,
}: {
  mail: UnassignedMail;
  accounts: { id: string; name: string }[];
  busy: boolean;
  onAct: (body: Record<string, unknown>) => void;
}) {
  const [other, setOther] = useState("");
  const [link, setLink] = useState<Link>("thread");
  const [ignore, setIgnore] = useState<Ignore>("");
  const domain = mail.from.split("@")[1];
  const assign = (clientId: string) => onAct({ action: "assign", clientId, link });

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground-strong" title={mail.from}>
            {mail.fromName ?? mail.from} <span className="font-normal text-muted-foreground">· @{domain}</span>
          </p>
          <p className="truncate text-sm text-foreground" title={mail.subject}>
            {mail.subject}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="tabular text-label-sm text-subtle-foreground">{fmt(mail.date)}</span>
          <span className="flex gap-1">
            {mail.messages > 1 && <Badge variant="outline">{mail.messages} mensajes</Badge>}
            {mail.iWrote && (
              <Badge variant="outline">
                <Reply className="size-3" /> Respondiste
              </Badge>
            )}
          </span>
        </div>
      </div>
      {mail.excerpt && <p className="line-clamp-3 text-xs leading-snug text-muted-foreground">{mail.excerpt}</p>}

      {/* Sugerencias por reglas: la más fuerte primero. */}
      {mail.suggestions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {mail.suggestions.map((s, i) => (
            <li key={s.clientId} className="flex flex-wrap items-center gap-2">
              <Button size="xs" variant={i === 0 ? "default" : "outline"} disabled={busy} onClick={() => assign(s.clientId)}>
                <UserPlus /> Es de {s.name}
              </Button>
              <span className="text-[11px] text-muted-foreground">{s.reasons.join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <select className={cn(inputClass, "h-7 w-auto min-w-40 py-0 text-xs")} value={other} onChange={(e) => setOther(e.target.value)} aria-label="Otra cuenta">
          <option value="">{mail.suggestions.length ? "Otra cuenta…" : "Elegir cuenta…"}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select className={cn(inputClass, "h-7 w-auto py-0 text-xs")} value={link} onChange={(e) => setLink(e.target.value as Link)} aria-label="Qué vincular">
          <option value="thread">Solo este hilo</option>
          <option value="sender">Siempre este remitente</option>
          <option value="domain">Siempre @{domain}</option>
        </select>
        <Button size="xs" variant="outline" disabled={busy || !other} onClick={() => assign(other)}>
          {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Asignar
        </Button>
        <a
          href={`https://mail.google.com/mail/#all/${mail.threadId}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Ver en Gmail <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          className="text-muted-foreground"
          disabled={busy}
          onClick={() => onAct({ action: "dismiss", ignore: ignore || null })}
        >
          <MailX /> No es de ninguna cuenta
        </Button>
        <select className={cn(inputClass, "h-7 w-auto py-0 text-xs")} value={ignore} onChange={(e) => setIgnore(e.target.value as Ignore)} aria-label="Ignorar de ahora en más">
          <option value="">Solo este mail</option>
          <option value="sender">Ignorar siempre a {mail.fromName?.split(" ")[0] ?? "este remitente"}</option>
          <option value="domain">Ignorar siempre @{domain}</option>
        </select>
      </div>
    </li>
  );
}
