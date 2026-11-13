"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Loader2, Mail, RefreshCw, Save, Send, Star } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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

const NEW_THREAD = "__new__";
/** Por qué el borrador eligió ese hilo (`pickFollowupThread`). */
const THREAD_REASON: Record<NonNullable<FollowupDraft["threadReason"]>, string> = {
  pinned: "Hilo de seguimiento fijado.",
  standard: "Hilo con el asunto de seguimiento (Xtract + … | Seguimiento / Etapa 2). Fijalo con ⭐ para usarlo siempre.",
  recent: "Último hilo donde escribió el cliente o le escribiste vos. Fijá con ⭐ el hilo de seguimiento para usarlo siempre.",
  new: "Mail nuevo con el asunto de seguimiento: al crearlo queda fijado como hilo de seguimiento.",
  anchor: "Responde en el hilo del último mail.",
};
const BUTTONS_RESERVE = 76;
const MIN_BODY_PX = 160;

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
  showTitle = false,
  fitViewport = false,
  bodyMaxClass = "max-h-[36dvh]",
  className,
}: {
  /** Muestra el título visible (vista Cuentas con dos borradores apilados, panel del Dashboard). */
  showTitle?: boolean;
  /** El mensaje crece con el texto y, si es largo, hasta el borde inferior de la pantalla (vista Cuentas). */
  fitViewport?: boolean;
  /** Tope de alto del mensaje cuando no se ajusta a la pantalla (crece con el texto hasta acá). */
  bodyMaxClass?: string;
  className?: string;
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
  const [cc, setCc] = useState(initial.cc?.join(", ") ?? "");
  // null = eligió mail nuevo; undefined = sin preferencia (último hilo).
  const [threadId, setThreadId] = useState<string>(
    initial.threadId === null ? NEW_THREAD : (initial.threadId ?? threads[0]?.threadId ?? NEW_THREAD),
  );
  const [state, setState] = useState<"idle" | "drafting" | "sending" | "updating" | "saving" | "copied">("idle");
  // Hilo fijado de la cuenta (optimista hasta el refresh).
  const [pinnedId, setPinnedId] = useState<string | null>(threads.find((t) => t.pinned)?.threadId ?? null);
  const [pinning, setPinning] = useState(false);
  async function togglePin() {
    if (threadId === NEW_THREAD) return;
    const unpin = pinnedId === threadId;
    const subjectOf = threads.find((t) => t.threadId === threadId)?.subject ?? subject;
    setPinning(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followupThread: unpin ? null : { threadId, subject: subjectOf } }),
      });
      if (!res.ok) throw new Error();
      setPinnedId(unpin ? null : threadId);
      router.refresh();
    } catch {
      setError("No se pudo fijar el hilo.");
    } finally {
      setPinning(false);
    }
  }
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const cancelSendRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Tope del mensaje = lo que queda de pantalla debajo de él, menos la barra de botones.
  useEffect(() => {
    const el = bodyRef.current;
    if (!fitViewport || !el) return;
    const fit = () => {
      const room = window.innerHeight - el.getBoundingClientRect().top - BUTTONS_RESERVE;
      el.style.maxHeight = `${Math.max(MIN_BODY_PX, room)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    ro.observe(el); // pestaña oculta → visible
    const card = el.closest("[data-slot=card]");
    if (card) ro.observe(card); // se despliega "Revisar antes de enviar", etc.
    return () => {
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, [fitViewport]);
  const recipients = to.split(/[,;\s]+/).filter(Boolean);
  const ccRecipients = cc.split(/[,;\s]+/).filter(Boolean);
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
      setCc(initial.cc?.join(", ") ?? "");
      if (initial.threadId !== undefined) setThreadId(initial.threadId ?? NEW_THREAD);
    }
  }
  const threadLabel =
    threadId === NEW_THREAD
      ? `mail nuevo: “${subject}”`
      : `el hilo “${threads.find((t) => t.threadId === threadId)?.subject ?? initial.subject}”`;
  const [result, setResult] = useState<{
    kind: "draft" | "sent";
    url: string;
    /** true = quedó en el hilo elegido; false = Gmail lo dejó fuera; null = mail nuevo. */
    inThread: boolean | null;
    where: string;
    to: string[];
    /** Se actualizó el borrador que ya existía (no se creó otro). */
    updated?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftCreatedAt = initial.draftCreatedAt;

  const payload = () => ({
    kind,
    meetingId: initial.meetingId,
    subject,
    body,
    to: to.split(/[,;\s]+/).filter(Boolean),
    cc: cc.split(/[,;\s]+/).filter(Boolean),
    threadId: threadId === NEW_THREAD ? null : threadId,
  });

  async function send() {
    setState("sending");
    setError(null);
    setResult(null);
    const where = threadLabel;
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
    setEdited(false);
    setSeenBody(""); // fuerza a tomar el borrador nuevo: el texto enviado no queda listo para reenviar
    setHasNews(false);
    setResult({ kind: "sent", url: data.gmailUrl, inThread: data.inThread ?? null, where, to: data.to ?? [] });
    router.refresh();
  }

  async function createDraft() {
    setState("drafting");
    setError(null);
    setResult(null);
    const where = threadLabel;
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
    setResult({ kind: "draft", url: data.gmailUrl, inThread: data.inThread ?? null, where, to: data.to ?? [], updated: !!data.updated });
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
      setCc(draft.cc?.join(", ") ?? "");
      setThreadId(draft.threadId === null ? NEW_THREAD : (draft.threadId ?? threads[0]?.threadId ?? NEW_THREAD));
      setSeenBody(draft.body);
      setEdited(false);
      setHasNews(false);
      setResult(null);
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

  // Guarda la edición (PUT): se conserva hasta que cambien los accionables o llegue un mail.
  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/followup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) throw new Error();
      setEdited(false);
      setNotice(`Guardado a las ${new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}.`);
    } catch {
      setError("No se pudo guardar el borrador.");
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
    <Card className={cn("lg:h-full", className)}>
      <CardHeader>
        <CardTitle className={showTitle ? "text-sm font-medium text-foreground-strong" : "sr-only"}>{title}</CardTitle>
        <p className="line-clamp-2 text-xs text-muted-foreground" title={hint}>
          {hint}
          {draftCreatedAt && ` Borrador creado el ${new Date(draftCreatedAt).toLocaleString("es")}.`}
          {lastSentAt && ` Último envío desde acá: ${new Date(lastSentAt).toLocaleString("es")}.`}
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 [scrollbar-width:thin] lg:overflow-y-auto">
        {hasNews && (
          <p className="rounded-md border border-border-strong bg-accent px-3 py-2 text-xs">
            Hay novedades (mails o accionables) y no pisé tu edición. Usá Regenerar para incorporarlas.
          </p>
        )}
        {!!generated.reviewNotes?.length && (
          <details className="shrink-0 rounded-md border border-warning/25 bg-warning-muted px-3 py-1.5 text-xs">
            <summary className="cursor-pointer font-medium">
              Revisar antes de enviar ({generated.reviewNotes.length}) · no forma parte del mail
            </summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {generated.reviewNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="grid shrink-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${kind}-thread`}>Dónde</Label>
          <div className="flex gap-1.5">
          <select
            id={`${kind}-thread`}
            value={threadId}
            onChange={(e) => {
              setThreadId(e.target.value);
              setEdited(true);
            }}
            className={`${inputClass} h-9 min-w-0 flex-1 dark:[color-scheme:dark] [&_option]:bg-popover [&_option]:text-popover-foreground`}
          >
            {threads.map((t, i) => (
              <option key={t.threadId} value={t.threadId}>
                {t.threadId === pinnedId ? "⭐ Hilo de seguimiento: " : i === 0 ? "Último hilo: " : "Responder en: "}
                {t.subject} ({new Date(t.date).toLocaleDateString("es", { day: "2-digit", month: "short" })})
              </option>
            ))}
            {threadId !== NEW_THREAD && !threads.some((t) => t.threadId === threadId) && (
              <option value={threadId}>Hilo del último mail: {subject}</option>
            )}
            <option value={NEW_THREAD}>Mail nuevo</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            disabled={threadId === NEW_THREAD || pinning}
            onClick={togglePin}
            aria-pressed={pinnedId === threadId}
            title={
              threadId === NEW_THREAD
                ? "Elegí un hilo para fijarlo como hilo de seguimiento"
                : pinnedId === threadId
                  ? "Quitar como hilo de seguimiento"
                  : "Fijar como hilo de seguimiento: los mails post-reunión van siempre acá"
            }
          >
            {pinning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Star className={cn("size-4", pinnedId === threadId && "fill-warning text-warning")} />
            )}
          </Button>
          </div>
          {threadId === (generated.threadId ?? NEW_THREAD) && generated.threadReason && (
            <p className="text-[11px] text-muted-foreground">{THREAD_REASON[generated.threadReason]}</p>
          )}
          {!threads.length && (
            <p className="text-[11px] text-muted-foreground">
              Sin hilos detectados: actualizá la trazabilidad para listar los hilos con referentes.
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${kind}-to`}>Para</Label>
          <input
            id={`${kind}-to`}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setEdited(true);
            }}
            title={to}
            className={`${inputClass} h-9`}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${kind}-cc`}>Cc</Label>
          <input
            id={`${kind}-cc`}
            value={cc}
            onChange={(e) => {
              setCc(e.target.value);
              setEdited(true);
            }}
            title={
              threadId === NEW_THREAD
                ? "Referentes y equipo Xtract en copia, para que todos queden al tanto."
                : "Resto del hilo en copia (Responder a todos), para no perder invitados."
            }
            className={`${inputClass} h-9`}
          />
        </div>
        {threadId === NEW_THREAD && (
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-body`}>Mensaje</Label>
          <textarea
            ref={bodyRef}
            id={`${kind}-body`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setEdited(true);
            }}
            rows={8}
            className={cn(inputClass, "field-sizing-content min-h-32 resize-y py-2 font-mono text-xs leading-relaxed", !fitViewport && bodyMaxClass)}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {confirmingUpdate && (
          <div className="space-y-2 rounded-md border border-input px-3 py-2 text-xs">
            <p>Regenerar reemplaza el texto por uno generado de nuevo: se pierde lo que editaste a mano.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={update}>
                <RefreshCw /> Regenerar igual
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingUpdate(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        {(state === "sending" || state === "drafting") && (
          <ActionProgress label={state === "sending" ? "Enviando el mail…" : "Creando el borrador en Gmail…"} />
        )}
        {result && <ResultBox result={result} onClose={() => setResult(null)} />}
        {!result && state !== "drafting" && initial.gmailDraftId && initial.gmailBody && initial.gmailBody !== body && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-xs text-foreground">
            <span className="min-w-0 flex-1">
              El borrador que está en Gmail no tiene los últimos cambios (avances o edición). Actualizalo para que quede igual a este.
            </span>
            <Button size="sm" variant="outline" onClick={createDraft}>
              <RefreshCw /> Actualizar borrador en Gmail
            </Button>
          </div>
        )}
        <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center gap-2 bg-card pt-1">
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
            {state === "updating" ? "Regenerando…" : "Regenerar"}
          </Button>
          <Button variant="outline" onClick={save} disabled={!edited || state === "saving"} title="Guarda tu edición del borrador">
            {state === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
            Guardar
          </Button>
          <Button variant="outline" onClick={createDraft} disabled={state === "drafting"}>
            {state === "drafting" ? <Loader2 className="animate-spin" /> : <Mail />}
            {initial.gmailDraftId ? "Actualizar en Gmail" : "Borrador en Gmail"}
          </Button>
          <Button variant="outline" onClick={copy}>
            {state === "copied" ? <Check /> : <Copy />} {state === "copied" ? "Copiado" : "Copiar"}
          </Button>
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
            {!!ccRecipients.length && (
              <div>
                <dt className="text-xs text-muted-foreground">Cc</dt>
                <dd className="break-words">{ccRecipients.join(", ")}</dd>
              </div>
            )}
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

/** Barra de progreso mientras Gmail responde: avanza sola hasta ~90% y desaparece al terminar. */
function ActionProgress({ label }: { label: string }) {
  const [value, setValue] = useState(8);
  useEffect(() => {
    const id = setInterval(() => setValue((v) => (v < 90 ? v + Math.max(1, (90 - v) / 8) : v)), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface px-3 py-2" role="status" aria-live="polite">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {label}
      </p>
      <Progress value={Math.round(value)} aria-label={label} />
    </div>
  );
}

function ResultBox({
  result,
  onClose,
}: {
  result: { kind: "draft" | "sent"; url: string; inThread: boolean | null; where: string; to: string[]; updated?: boolean };
  onClose: () => void;
}) {
  const sent = result.kind === "sent";
  const outOfThread = result.inThread === false;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-3 py-2.5 text-xs",
        outOfThread ? "border-warning/30 bg-warning-muted" : "border-success/30 bg-success-muted",
      )}
    >
      {outOfThread ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5 text-foreground">
        <p className="font-medium">
          {sent ? "Mail enviado correctamente." : result.updated ? "Borrador actualizado en Gmail (el mismo, sin duplicar)." : "Borrador creado en Gmail."}
        </p>
        <p className="text-muted-foreground">
          {result.inThread === true
            ? `Quedó dentro de la cadena: ${result.where}.`
            : result.inThread === false
              ? `Gmail lo dejó fuera del hilo elegido (${result.where}). Revisalo antes de enviarlo.`
              : `Va como ${result.where}.`}
          {sent && result.to.length > 0 && ` Para: ${result.to.join(", ")}.`}
          {sent && " El borrador de la cuenta se regenera a partir de este envío."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant={sent ? "outline" : "default"} render={<a href={result.url} target="_blank" rel="noopener noreferrer" />}>
          {sent ? "Ver en Gmail" : "Abrir borrador"} <ExternalLink />
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}
