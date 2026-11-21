"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Star,
} from "lucide-react";
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
import { MailKindToggle, useMailKind } from "@/components/cuentas/MailKindSwitch";

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
// mail nuevo. Pensado para que el cuerpo se vea lo más posible: encabezado en una fila (título, ⓘ, chip de
// revisión, selector de tipo, expandir), destinatarios resumidos en una línea con "Editar" (se abren solos si
// falta Para o el asunto de un mail nuevo) y la descripción solo en pantallas altas (variante `short`).
// `expandable`: botón ⤢ que abre el mismo editor casi a pantalla completa.
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
  expandable = false,
  className,
}: {
  /** Botón ⤢: el mismo editor en un modal casi a pantalla completa. */
  expandable?: boolean;
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
  // Con selector General | Pedir status, el modo expandido es compartido: solo lo muestra el mail elegido, así
  // cambiar de tipo con el modal abierto cambia el mail de adentro.
  const mailKind = useMailKind();
  const [localExpanded, setLocalExpanded] = useState(false);
  const shared = mailKind?.setExpanded != null;
  const active = !mailKind || mailKind.choice === (kind === "reminder" ? "reminder" : "general");
  const expanded = shared ? !!mailKind.expanded && active : localExpanded;
  const setExpanded = (next: boolean | ((e: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(expanded) : next;
    if (shared) mailKind.setExpanded!(value);
    else setLocalExpanded(value);
  };
  const [showFields, setShowFields] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  // Tope del mensaje = lo que queda de pantalla debajo de él, menos la barra de botones.
  useEffect(() => {
    const el = bodyRef.current;
    if (!fitViewport || expanded || !el) return;
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
  }, [fitViewport, expanded]);
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
    ticketId: initial.ticketId ?? null,
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
        body: JSON.stringify({ kind, meetingId: initial.meetingId, ticketId: initial.ticketId ?? null }),
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

  const hintText = [
    hint,
    draftCreatedAt && `Borrador creado el ${new Date(draftCreatedAt).toLocaleString("es")}.`,
    lastSentAt && `Último envío desde acá: ${new Date(lastSentAt).toLocaleString("es")}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const notes = generated.reviewNotes ?? [];
  // Destinatarios en una línea; los campos se abren solos si falta algo para poder enviar.
  const fieldsOpen = showFields || !recipients.length || (threadId === NEW_THREAD && !subject.trim());
  const threadSubject = threads.find((t) => t.threadId === threadId)?.subject ?? initial.subject;
  const whereShort = threadId === NEW_THREAD ? `Mail nuevo: “${subject}”` : `${pinnedId === threadId ? "⭐ " : ""}${threadSubject}`;
  const reason = threadId === (generated.threadId ?? NEW_THREAD) && generated.threadReason ? THREAD_REASON[generated.threadReason] : null;

  const card = (
    <Card className={cn(expanded ? "h-full min-h-0 rounded-none border-0" : "lg:h-full", !expanded && className)}>
      <CardHeader className="gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <CardTitle className={showTitle || expanded ? "text-sm font-medium text-foreground-strong" : "sr-only"}>{title}</CardTitle>
          <span title={hintText} aria-label={hintText} className="flex cursor-help text-subtle-foreground hover:text-foreground">
            <Info className="size-3.5" />
          </span>
          {!!notes.length && (
            <button
              type="button"
              aria-expanded={showNotes}
              onClick={() => setShowNotes((o) => !o)}
              title="Avisos para revisar antes de enviar; no forman parte del mail"
              className="inline-flex items-center gap-1 rounded-md border border-warning/25 bg-warning-muted px-1.5 py-px text-[11px] font-medium text-warning hover:border-warning/50"
            >
              <AlertTriangle className="size-3" /> {notes.length} a revisar
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <MailKindToggle />
            {expandable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setExpanded((e) => !e)}
                title={expanded ? "Volver a la cuenta" : "Expandir el mail"}
                aria-label={expanded ? "Volver a la cuenta" : "Expandir el mail"}
              >
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
          </div>
        </div>
        <p className="line-clamp-1 text-xs text-muted-foreground short:hidden" title={hintText}>
          {hint}
        </p>
      </CardHeader>
      <CardContent className={cn("flex min-h-0 flex-1 flex-col gap-3 [scrollbar-width:thin]", expanded ? "overflow-y-auto" : "lg:overflow-y-auto")}>
        {hasNews && (
          <p className="rounded-md border border-border-strong bg-accent px-3 py-2 text-xs">
            Hay novedades (mails o accionables) y no pisé tu edición. Usá Regenerar para incorporarlas.
          </p>
        )}
        {showNotes && !!notes.length && (
          <ul className="shrink-0 list-disc space-y-0.5 rounded-md border border-warning/25 bg-warning-muted py-1.5 pr-3 pl-7 text-xs">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {!fieldsOpen && (
          <div className="flex min-w-0 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs">
            <p
              className="min-w-0 flex-1 truncate"
              title={[`Dónde: ${threadLabel}`, reason, `Para: ${recipients.join(", ")}`, ccRecipients.length ? `Cc: ${ccRecipients.join(", ")}` : null]
                .filter(Boolean)
                .join("\n")}
            >
              <span className="text-subtle-foreground">En </span>
              <span className="text-foreground">{whereShort}</span>
              <span className="text-subtle-foreground"> · Para </span>
              <span className="text-foreground">{recipients.join(", ")}</span>
              {!!ccRecipients.length && (
                <span className="text-subtle-foreground">
                  {" "}
                  · Cc <span className="tabular text-foreground">{ccRecipients.length}</span>
                </span>
              )}
            </p>
            <Button type="button" size="xs" variant="ghost" onClick={() => setShowFields(true)}>
              <Pencil /> Editar
            </Button>
          </div>
        )}
        {fieldsOpen && (
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
          {reason && <p className="text-[11px] text-muted-foreground">{reason}</p>}
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
        {showFields && (
          <div className="flex justify-end sm:col-span-2">
            <Button type="button" size="xs" variant="ghost" onClick={() => setShowFields(false)}>
              <Check /> Listo
            </Button>
          </div>
        )}
        </div>
        )}
        <div className={cn("flex flex-col gap-1.5", expanded && "min-h-0 flex-1")}>
          <Label htmlFor={`${kind}-body`} className="sr-only">
            Mensaje
          </Label>
          <textarea
            ref={bodyRef}
            id={`${kind}-body`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setEdited(true);
            }}
            rows={8}
            className={cn(
              inputClass,
              "min-h-32 py-2 font-mono text-xs leading-relaxed",
              expanded ? "h-full flex-1 resize-none text-[13px]" : "field-sizing-content resize-y",
              !fitViewport && !expanded && bodyMaxClass,
            )}
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

  if (!expanded) return card;
  const placeholder = (
    <p className="rounded-lg border border-dashed border-divider p-4 text-center text-xs text-muted-foreground">
      Editando “{title}” en pantalla completa.
    </p>
  );
  // Con selector: un solo modal (de `MailKindSwitch`) que queda abierto; al cambiar de tipo solo cambia el
  // contenido, con un fundido corto.
  if (shared) {
    return (
      <>
        {placeholder}
        {mailKind.portal &&
          createPortal(
            <div className="flex min-h-0 flex-1 flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">{card}</div>,
            mailKind.portal,
          )}
      </>
    );
  }
  return (
    <>
      {placeholder}
      <Dialog open onOpenChange={(o) => !o && setExpanded(false)}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[94dvh] w-[min(80rem,calc(100%-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {card}
        </DialogContent>
      </Dialog>
    </>
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
