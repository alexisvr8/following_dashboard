"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, Mail, RefreshCw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { FollowupDraft, FollowupKind, ThreadRef } from "@/lib/store/clients-store";

const inputClass =
  "w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const NEW_THREAD = "__new__";

// Borrador de follow-up o seguimiento: se mantiene al día solo mientras no lo edites; editable,
// copiable, creado como draft en Gmail o enviado (con confirmación) dentro del hilo elegido o como
// mail nuevo.
export function FollowupComposer({
  kind,
  clientId,
  title,
  hint,
  initial,
  generated,
  threads,
  lastSentAt,
}: {
  kind: FollowupKind;
  clientId: string;
  title: string;
  hint: string;
  initial: FollowupDraft;
  /** Versión generada con el estado actual (de ahí salen los avisos de revisión). */
  generated: FollowupDraft;
  threads: ThreadRef[];
  lastSentAt: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [to, setTo] = useState(initial.to.join(", "));
  // null = eligió mail nuevo; undefined = sin preferencia (último hilo).
  const [threadId, setThreadId] = useState<string>(
    initial.threadId === null ? NEW_THREAD : (initial.threadId ?? threads[0]?.threadId ?? NEW_THREAD),
  );
  const [state, setState] = useState<"idle" | "saving" | "drafting" | "sending" | "updating" | "copied" | "saved">("idle");
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cancelSendRef = useRef<HTMLButtonElement>(null);
  const recipients = to.split(/[,;\s]+/).filter(Boolean);
  const [sentNow, setSentNow] = useState(false);
  // Novedades (mails, reuniones, accionables): se aplican solas salvo que estés editando.
  const [seenBody, setSeenBody] = useState(initial.body);
  const [edited, setEdited] = useState(false);
  const [hasNews, setHasNews] = useState(false);
  if (initial.body !== seenBody) {
    setSeenBody(initial.body);
    if (edited) {
      setHasNews(true);
    } else {
      setSubject(initial.subject);
      setBody(initial.body);
      setTo(initial.to.join(", "));
      if (initial.threadId) setThreadId(initial.threadId);
    }
  }
  const threadLabel =
    threadId === NEW_THREAD
      ? `mail nuevo: “${subject}”`
      : `el hilo “${threads.find((t) => t.threadId === threadId)?.subject ?? initial.subject}”`;
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
    if (res.ok) {
      setEdited(false);
      setHasNews(false);
    } else {
      setError("No se pudo guardar");
    }
  }

  async function send() {
    setState("sending");
    setError(null);
    setConfirming(false);
    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(), send: true }),
    });
    const data = await res.json();
    setState("idle");
    if (!res.ok) {
      setError(
        data.error === "google_not_connected"
          ? "Google no está conectado."
          : data.error === "no_recipients"
            ? "Agregá al menos un destinatario."
            : `No se envió: ${data.error}`,
      );
      return;
    }
    setSentNow(true);
    setEdited(false);
    setSeenBody(""); // fuerza a tomar el borrador nuevo: el texto enviado no queda listo para reenviar
    setHasNews(false);
    setGmailUrl(data.gmailUrl);
    router.refresh();
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

  async function update() {
    setState("updating");
    setError(null);
    setNotice(null);
    setConfirmingUpdate(false);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/followup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, meetingId: initial.meetingId }),
      });
      if (!res.ok) throw new Error();
      const { draft, synced } = (await res.json()) as { draft: FollowupDraft; synced: boolean };
      setSubject(draft.subject);
      setBody(draft.body);
      setTo(draft.to.join(", "));
      setThreadId(draft.threadId ?? threads[0]?.threadId ?? NEW_THREAD);
      setSeenBody(draft.body);
      setEdited(false);
      setHasNews(false);
      setSentNow(false);
      setNotice(
        synced
          ? `Actualizado a las ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}.`
          : "No se pudo consultar Gmail: se generó con los datos de la última sincronización.",
      );
      router.refresh();
    } catch {
      setError("No se pudo actualizar el borrador.");
    } finally {
      setState("idle");
    }
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
          {lastSentAt && ` Último envío desde acá: ${new Date(lastSentAt).toLocaleString("es")}.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasNews && (
          <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
            Hay novedades (mails o accionables) y no pisé tu edición. Usá Actualizar para incorporarlas.
          </p>
        )}
        {!!generated.reviewNotes?.length && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <p className="font-medium">Revisar antes de enviar (no forma parte del mail)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {generated.reviewNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${kind}-thread`}>Dónde</Label>
          <select
            id={`${kind}-thread`}
            value={threadId}
            onChange={(e) => {
              setThreadId(e.target.value);
              setEdited(true);
            }}
            className={`${inputClass} h-9`}
          >
            {threads.map((t, i) => (
              <option key={t.threadId} value={t.threadId}>
                {i === 0 ? "Último hilo: " : "Responder en: "}
                {t.subject} ({new Date(t.date).toLocaleDateString("es", { day: "2-digit", month: "short" })})
              </option>
            ))}
            {threadId !== NEW_THREAD && !threads.some((t) => t.threadId === threadId) && (
              <option value={threadId}>Hilo del último mail: {subject}</option>
            )}
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
          <input
            id={`${kind}-to`}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setEdited(true);
            }}
            className={`${inputClass} h-9`}
          />
        </div>
        {threadId === NEW_THREAD && (
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-subject`}>Asunto</Label>
            <input
              id={`${kind}-subject`}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setEdited(true);
              }}
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
              setEdited(true);
              if (state === "saved") setState("idle");
            }}
            rows={14}
            className={`${inputClass} py-2 font-mono text-xs leading-relaxed`}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {confirmingUpdate && (
          <div className="space-y-2 rounded-md border border-input px-3 py-2 text-xs">
            <p>Actualizar reemplaza el texto por uno generado de nuevo: se pierde lo que editaste a mano.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={update}>
                <RefreshCw /> Actualizar igual
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingUpdate(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        {sentNow && (
          <p className="text-xs text-primary">Mail enviado. El borrador ya se generó de nuevo a partir de este envío.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setConfirming(true)} disabled={state === "sending" || confirming}>
            {state === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
            Enviar
          </Button>
          <Button
            variant="outline"
            onClick={() => (edited ? setConfirmingUpdate(true) : update())}
            disabled={state === "updating" || confirmingUpdate}
            title="Trae los mails nuevos de la cuenta y genera el mail de nuevo con los accionables actuales"
          >
            {state === "updating" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {state === "updating" ? "Actualizando…" : "Actualizar"}
          </Button>
          <Button variant="outline" onClick={createDraft} disabled={state === "drafting"}>
            {state === "drafting" ? <Loader2 className="animate-spin" /> : <Mail />}
            Borrador en Gmail
          </Button>
          <Button variant="outline" onClick={copy}>
            {state === "copied" ? <Check /> : <Copy />} {state === "copied" ? "Copiado" : "Copiar"}
          </Button>
          {/* <Button variant="ghost" onClick={save} disabled={state === "saving"}>
            {state === "saved" ? <Check /> : <Save />} {state === "saved" ? "Guardado" : "Guardar edición"}
          </Button> */}
          {gmailUrl && (
            <a
              href={gmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {sentNow ? "Ver en Gmail" : "Abrir en Gmail para enviar"} <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </CardContent>
      {/* Evita envíos por error: el foco arranca en Cancelar, así un Enter no dispara el mail. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent initialFocus={cancelSendRef} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Enviar este mail?</DialogTitle>
            <DialogDescription>Un mail enviado no se puede deshacer. Revisá los datos antes de confirmar.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Para</dt>
              <dd className="break-words font-medium">{recipients.join(", ") || "Sin destinatarios"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dónde</dt>
              <dd className="break-words">{threadLabel}</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button ref={cancelSendRef} variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button onClick={send} disabled={!recipients.length}>
              <Send /> Sí, enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
