"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, Mail, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { FollowupDraft, FollowupKind, ThreadRef } from "@/lib/store/clients-store";

const inputClass =
  "w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const NEW_THREAD = "__new__";

// Borrador de follow-up generado de la minuta: editable, copiable o creado como draft en Gmail
// dentro del último hilo con referentes (o el que se elija / hilo nuevo). Nunca envía.
export function FollowupComposer({
  kind,
  clientId,
  title,
  hint,
  initial,
  generated,
  threads,
}: {
  kind: FollowupKind;
  clientId: string;
  title: string;
  hint: string;
  initial: FollowupDraft;
  /** Versión generada con el estado actual (para "Regenerar"). */
  generated: FollowupDraft;
  threads: ThreadRef[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [to, setTo] = useState(initial.to.join(", "));
  const [threadId, setThreadId] = useState<string>(initial.threadId ?? threads[0]?.threadId ?? NEW_THREAD);
  const [state, setState] = useState<"idle" | "saving" | "drafting" | "copied" | "saved">("idle");
  const [gmailUrl, setGmailUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftCreatedAt = initial.draftCreatedAt;

  const payload = () => ({
    kind,
    meetingId: initial.meetingId,
    subject,
    body,
    to: to.split(/[,;\s]+/).filter(Boolean),
    threadId: threadId === NEW_THREAD ? null : threadId,
  });

  async function save() {
    setState("saving");
    setError(null);
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/followup`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    setState(res.ok ? "saved" : "idle");
    if (!res.ok) setError("No se pudo guardar");
  }

  async function createDraft() {
    setState("drafting");
    setError(null);
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const data = await res.json();
    setState("idle");
    if (!res.ok) {
      setError(
        data.error === "google_not_connected"
          ? "Google no está conectado."
          : data.error === "no_recipients"
            ? "Agregá al menos un destinatario."
            : `Error: ${data.error}`,
      );
      return;
    }
    setGmailUrl(data.gmailUrl);
    router.refresh();
  }

  function regenerate() {
    setSubject(generated.subject);
    setBody(generated.body);
    setTo(generated.to.join(", "));
    setState("idle");
  }

  async function copy() {
    await navigator.clipboard.writeText(threadId === NEW_THREAD ? `${subject}\n\n${body}` : body);
    setState("copied");
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {hint} Revisalo, editalo y crealo como borrador en Gmail o copialo.
          {draftCreatedAt && ` Borrador creado el ${new Date(draftCreatedAt).toLocaleString("es")}.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-thread`}>Dónde</Label>
          <select
            id={`${kind}-thread`}
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            className={`${inputClass} h-9`}
          >
            {threads.map((t, i) => (
              <option key={t.threadId} value={t.threadId}>
                {i === 0 ? "Último hilo: " : "Responder en: "}
                {t.subject} ({new Date(t.date).toLocaleDateString("es", { day: "2-digit", month: "short" })})
              </option>
            ))}
            <option value={NEW_THREAD}>Mail nuevo</option>
          </select>
          {!threads.length && (
            <p className="text-[11px] text-muted-foreground">
              Sin hilos detectados: actualizá la trazabilidad para listar los hilos con referentes.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-to`}>Para</Label>
          <input id={`${kind}-to`} value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} h-9`} />
        </div>
        {threadId === NEW_THREAD && (
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-subject`}>Asunto</Label>
            <input
              id={`${kind}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={`${inputClass} h-9`}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-body`}>Mensaje</Label>
          <textarea
            id={`${kind}-body`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (state === "saved") setState("idle");
            }}
            rows={14}
            className={`${inputClass} py-2 font-mono text-xs leading-relaxed`}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={createDraft} disabled={state === "drafting"}>
            {state === "drafting" ? <Loader2 className="animate-spin" /> : <Mail />}
            Crear borrador en Gmail
          </Button>
          <Button variant="outline" onClick={copy}>
            {state === "copied" ? <Check /> : <Copy />} {state === "copied" ? "Copiado" : "Copiar"}
          </Button>
          <Button variant="ghost" onClick={save} disabled={state === "saving"}>
            {state === "saved" ? <Check /> : <Save />} {state === "saved" ? "Guardado" : "Guardar edición"}
          </Button>
          {body !== generated.body && (
            <Button variant="ghost" onClick={regenerate} title="Volver a generar con el estado actual de accionables y mails">
              <RotateCcw /> Regenerar
            </Button>
          )}
          {gmailUrl && (
            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Abrir en Gmail para enviar <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
