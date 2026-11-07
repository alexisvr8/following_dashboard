"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TicketItem } from "@/components/dashboard/TicketItem";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isAutoTicket } from "@/lib/utils/auto-ticket";
import type { ExecutedEntry } from "@/lib/utils/actionables";
import type { Ticket } from "@/types/ticket";

// Accionables de una cuenta. Pendientes: lo del último mail, la última reunión y lo arrastrado.
// Ejecutadas: aparte, con su fecha, para que lo cerrado no compita con lo que falta hacer.
// Con `editable` se pueden corregir, quitar y agregar puntos: el cambio llega a la cuenta y a los mails.

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "2-digit" });

function weekLabel(weekStart: string, latestWeek: string | undefined): string {
  const d = new Date(`${weekStart}T12:00:00`);
  const label = d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  if (!latestWeek || weekStart === latestWeek) return `Última reunión · semana del ${label}`;
  return `Arrastrados · semana del ${label}`;
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <h5 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</h5>;
}

const fieldClass =
  "h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-sm outline-none transition-shadow placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:shadow-highlight";

type State = Record<string, { isDone: boolean; doneAt: string | null }>;
type Editable = { clientId: string; onChanged: () => void };

export function ActionablesList({
  tickets,
  history = [],
  onToggle,
  onSaved,
  emptyText = "No hay accionables.",
  editable,
  dense = false,
}: {
  tickets: Ticket[];
  /** Cerradas de reuniones que ya no están vigentes: solo lectura. */
  history?: ExecutedEntry[];
  onToggle?: (ticketId: string, isDone: boolean) => void;
  onSaved?: (ticketId: string, isDone: boolean) => void;
  emptyText?: string;
  editable?: Editable;
  /** Filas compactas en una lista con divisores (vista Cuentas). */
  dense?: boolean;
}) {
  const [state, setState] = useState<State>({});
  // Cambios ya guardados, hasta que llegue el refresco del servidor.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = useMemo(
    () =>
      tickets
        .filter((t) => !removed.has(t.id))
        .map((t) => {
          const s = state[t.id];
          const title = titles[t.id] ?? t.title;
          return s ? { ...t, title, isDone: s.isDone, doneAt: s.doneAt } : { ...t, title };
        }),
    [tickets, state, titles, removed],
  );

  const latestWeek = tickets
    .filter((t) => t.source === "gemini_notes" && !t.carried)
    .map((t) => t.weekStartDate)
    .sort()
    .at(-1);
  const pending = view.filter((t) => !t.isDone);
  const pendingMail = pending.filter((t) => t.origin === "mail");
  const pendingMeeting = pending.filter((t) => t.origin !== "mail");
  const finished = view
    .filter((t) => t.isDone)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const groups = [...new Set(pendingMeeting.map((t) => t.weekStartDate))].sort().reverse();

  function toggle(id: string, isDone: boolean) {
    setState((prev) => ({
      ...prev,
      [id]: { isDone, doneAt: isDone ? (prev[id]?.doneAt ?? new Date().toISOString()) : null },
    }));
    onToggle?.(id, isDone);
  }

  function saved(id: string, isDone: boolean, doneAt: string | null) {
    setState((prev) => ({ ...prev, [id]: { isDone, doneAt: isDone ? doneAt : null } }));
    onSaved?.(id, isDone);
  }

  async function change(actionable: Record<string, unknown>): Promise<boolean> {
    if (!editable) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(editable.clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionable }),
      });
      if (!res.ok) {
        setError("No se pudo guardar. Probá de nuevo.");
        return false;
      }
      editable.onChanged();
      return true;
    } catch {
      setError("No se pudo guardar. Probá de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing?.title.trim()) return;
    const { id, title } = editing;
    if (await change({ op: "edit", id, title })) {
      setTitles((prev) => ({ ...prev, [id]: title.trim() }));
      setEditing(null);
    }
  }

  async function remove(id: string) {
    if (await change({ op: "remove", id })) setRemoved((prev) => new Set(prev).add(id));
    setConfirmRemove(null);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    if (await change({ op: "add", title: draft })) setDraft("");
  }

  if (!view.length && !history.length && !editable) return <p className="text-xs text-muted-foreground">{emptyText}</p>;

  const box = dense ? "divide-y divide-row-divider overflow-hidden rounded-lg border bg-card" : "space-y-2";

  const actionsFor = (t: Ticket) => {
    if (!editable || isAutoTicket(t.id)) return undefined;
    const iconBtn = "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
    if (confirmRemove === t.id) {
      return (
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          ¿Quitar?
          <button type="button" className={iconBtn} aria-label="Confirmar: quitar punto" disabled={busy} onClick={() => remove(t.id)}>
            <Check className="size-3.5" />
          </button>
          <button type="button" className={iconBtn} aria-label="Cancelar" onClick={() => setConfirmRemove(null)}>
            <X className="size-3.5" />
          </button>
        </span>
      );
    }
    return (
      <span className="flex shrink-0 items-center">
        <button type="button" className={iconBtn} title="Editar punto" aria-label="Editar punto" onClick={() => setEditing({ id: t.id, title: t.title })}>
          <Pencil className="size-3.5" />
        </button>
        <button type="button" className={iconBtn} title="Quitar punto" aria-label="Quitar punto" onClick={() => setConfirmRemove(t.id)}>
          <Trash2 className="size-3.5" />
        </button>
      </span>
    );
  };

  const item = (t: Ticket, prefix: "p" | "d", meta?: string) =>
    editing?.id === t.id ? (
      <form
        key={`e-${t.id}`}
        className="flex items-center gap-2 rounded-md border px-2 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void saveEdit();
        }}
      >
        <input
          autoFocus
          aria-label="Texto del punto"
          className={fieldClass}
          value={editing.title}
          onChange={(e) => setEditing({ id: t.id, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(null);
            }
          }}
        />
        <Button type="submit" size="sm" disabled={busy || !editing.title.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />} Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancelar
        </Button>
      </form>
    ) : (
      <TicketItem key={`${prefix}-${t.id}`} ticket={t} onToggle={toggle} onSaved={saved} meta={meta} actions={actionsFor(t)} dense={dense} />
    );

  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">Pendientes ({pending.length})</TabsTrigger>
        <TabsTrigger value="done">Ejecutadas ({finished.length + history.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="space-y-4 pt-2">
        {pendingMail.length > 0 && (
          <div className="space-y-2">
            <GroupTitle>De mails</GroupTitle>
            <div className={box}>{pendingMail.map((t) => item(t, "p"))}</div>
          </div>
        )}
        {groups.map((week) => (
          <div key={week} className="space-y-2">
            <GroupTitle>{weekLabel(week, latestWeek)}</GroupTitle>
            <div className={box}>{pendingMeeting.filter((t) => t.weekStartDate === week).map((t) => item(t, "p"))}</div>
          </div>
        ))}
        {!pending.length && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-primary" /> {view.length ? "Todo finalizado." : emptyText}
          </p>
        )}
        {editable && (
          <form onSubmit={add} className="flex items-center gap-2">
            <input
              className={fieldClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Agregar un punto… (es tuyo; para otra persona: [Nombre] texto)"
              aria-label="Agregar un punto"
            />
            <Button type="submit" variant="outline" disabled={busy || !draft.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} Agregar
            </Button>
          </form>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </TabsContent>

      <TabsContent value="done" className="space-y-2 pt-2">
        {finished.length > 0 && <div className={box}>{finished.map((t) => item(t, "d", t.doneAt ? fmtDay(t.doneAt) : "sin fecha"))}</div>}
        {history.length > 0 && (
          <div className="space-y-2 pt-2">
            <GroupTitle>Reuniones anteriores</GroupTitle>
            <div className={box}>
            {history.map((h) => (
              <div key={h.id} className={dense ? "flex items-start gap-2.5 px-2.5 py-2 text-[13px] leading-snug" : "flex items-center gap-3 rounded-md border bg-surface px-3 py-2 text-sm"}>
                <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 text-muted-foreground">
                  {h.title}
                  <span className="block text-[11px]">{h.meetingTitle}</span>
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtDay(h.doneAt)}</span>
              </div>
            ))}
            </div>
          </div>
        )}
        {!finished.length && !history.length && (
          <p className="text-xs text-muted-foreground">Todavía no hay tareas ejecutadas.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
