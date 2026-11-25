import { auditView } from "@/lib/utils/account-audit";
import {
  getClient,
  resolveAudit,
  changeActionable,
  closeClient,
  reopenClient,
  resolveRewrite,
  resolveSuggestion,
  resolveWeeklyReview,
  setFollowupThread,
  setActionablePlan,
  setTicketDone,
  updateClient,
  updateClientProfile,
  type ActionableChange,
  type ClientProfile,
  type ClientStatus,
  type WeeklyReviewAction,
} from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";

const STATUSES: ClientStatus[] = ["pending", "assigned", "unassigned", "ignored"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    status?: ClientStatus;
    name?: string;
    ticketId?: string;
    isDone?: boolean;
    profile?: Omit<Partial<ClientProfile>, "followupSnooze"> & { followupSnooze?: "tomorrow" | "interaction" | null };
    actionable?: ActionableChange;
    plan?: { ticketId?: unknown; due?: unknown; estimateMinutes?: unknown; side?: unknown };
    suggestion?: { suggestionId?: unknown; action?: unknown; title?: unknown; due?: unknown };
    rewrite?: { ref?: unknown; action?: unknown; title?: unknown };
    audit?: { key?: unknown; action?: unknown; title?: unknown };
    weeklyReview?: { id?: unknown; action?: unknown; title?: unknown; due?: unknown; reason?: unknown };
    followupThread?: { threadId?: unknown; subject?: unknown } | null;
    close?: { note?: unknown; handedTo?: unknown };
    reopen?: boolean;
  };

  // Cierre de la cuenta (pase a Soporte) / reapertura. El estado `closed` solo se pone por acá.
  if (body.close && typeof body.close === "object") {
    const { note, handedTo } = body.close;
    const client = await closeClient(decodeURIComponent(id), {
      note: typeof note === "string" ? note : undefined,
      handedTo: typeof handedTo === "string" ? handedTo.slice(0, 120) : undefined,
    });
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, status: client.status, closure: client.profile?.closure ?? null });
  }
  if (body.reopen === true) {
    const client = await reopenClient(decodeURIComponent(id));
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, status: client.status });
  }

  // Hilo de seguimiento fijado (⭐ en el composer); `null` lo quita.
  if (body.followupThread !== undefined) {
    const t = body.followupThread;
    if (t !== null && (typeof t?.threadId !== "string" || !/^[0-9a-f]{6,40}$/i.test(t.threadId) || typeof t.subject !== "string")) {
      return Response.json({ error: "invalid_thread" }, { status: 400 });
    }
    const client = await setFollowupThread(
      decodeURIComponent(id),
      t ? { threadId: t.threadId as string, subject: t.subject as string } : null,
    );
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, followupThread: client.profile?.followupThread ?? null });
  }

  // Auditoría única (modal "Auditoría"): aplicar una propuesta (tildar, quitar, lado, texto, fecha, nuevo, perfil) o
  // descartarla. La propuesta se recalcula acá contra el estado actual (`auditView`): el cliente solo manda la clave.
  if (body.audit && typeof body.audit === "object") {
    const { key, action, title } = body.audit;
    if (typeof key !== "string" || (action !== "apply" && action !== "dismiss")) {
      return Response.json({ error: "invalid_audit" }, { status: 400 });
    }
    const clientId = decodeURIComponent(id);
    const [{ client: current }, settings] = await Promise.all([getClient(clientId), getSettings()]);
    const proposal = current ? auditView(current, settings)?.proposals.find((p) => p.key === key) : undefined;
    if (!current || !proposal) return Response.json({ error: "not_found" }, { status: 404 });
    const override = typeof title === "string" && title.trim() && (proposal.kind === "edit" || proposal.kind === "add") ? title.trim() : undefined;
    const client = await resolveAudit(
      clientId,
      { key, kind: proposal.kind, ticketId: proposal.ticketId, ...proposal.apply, ...(override && { title: override }) },
      action,
    );
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id });
  }

  // Reescritura del análisis semanal (modal "Mejoras IA"): aceptar = edición del texto; descartar = ocultar.
  if (body.rewrite && typeof body.rewrite === "object") {
    const { ref, action, title } = body.rewrite;
    if (
      typeof ref !== "string" ||
      !/^A\d{1,3}$/.test(ref) ||
      (action !== "accept" && action !== "dismiss") ||
      (action === "accept" && (typeof title !== "string" || !title.trim()))
    ) {
      return Response.json({ error: "invalid_rewrite" }, { status: 400 });
    }
    const client = await resolveRewrite(decodeURIComponent(id), ref, action, typeof title === "string" ? title : undefined);
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id });
  }

  // Revisión del mail semanal: punto quitado (hecho / no corresponde / sigue), agregado (crear card / ignorar) o
  // cuenta sin mail (confirmar con motivo).
  if (body.weeklyReview && typeof body.weeklyReview === "object") {
    const { id: itemId, action, title, due, reason } = body.weeklyReview;
    const actions: WeeklyReviewAction[] = ["done", "not_applicable", "keep", "create", "ignore", "ok"];
    const validDue = due == null || (typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due));
    if (typeof itemId !== "string" || !actions.includes(action as WeeklyReviewAction) || !validDue) {
      return Response.json({ error: "invalid_weekly_review" }, { status: 400 });
    }
    const result = await resolveWeeklyReview(decodeURIComponent(id), {
      id: itemId,
      action: action as WeeklyReviewAction,
      title: typeof title === "string" ? title : undefined,
      due: (due as string | null | undefined) ?? null,
      reason: typeof reason === "string" ? reason : undefined,
    });
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: result.client.id, ticketId: result.ticketId });
  }

  // Sugerencia de la transcripción: aceptar (crea accionable propio) o descartar (enseña a no repetirla).
  if (body.suggestion && typeof body.suggestion === "object") {
    const { suggestionId, action, title, due } = body.suggestion;
    const validDue = due == null || (typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due));
    if (typeof suggestionId !== "string" || (action !== "accept" && action !== "dismiss") || !validDue) {
      return Response.json({ error: "invalid_suggestion" }, { status: 400 });
    }
    const result = await resolveSuggestion(decodeURIComponent(id), {
      suggestionId,
      action,
      title: typeof title === "string" ? title : undefined,
      due: (due as string | null | undefined) ?? null,
    });
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: result.client.id, ticketId: result.ticketId });
  }

  // Fecha de entrega / estimación manual de un accionable (vista Seguimiento).
  if (body.plan && typeof body.plan === "object") {
    const { ticketId, due, estimateMinutes, side } = body.plan;
    const validSide = side === undefined || side === null || side === "debo" || side === "me_deben";
    const validDue = due === null || (typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due) && !Number.isNaN(Date.parse(due)));
    const validEst = estimateMinutes === null || (typeof estimateMinutes === "number" && estimateMinutes >= 5 && estimateMinutes <= 480);
    if (typeof ticketId !== "string" || (due !== undefined && !validDue) || (estimateMinutes !== undefined && !validEst) || !validSide) {
      return Response.json({ error: "invalid_plan" }, { status: 400 });
    }
    const client = await setActionablePlan(decodeURIComponent(id), {
      ticketId,
      ...(due !== undefined && { due: due as string | null }),
      ...(estimateMinutes !== undefined && { estimateMinutes: estimateMinutes === null ? null : Math.round(estimateMinutes as number) }),
      ...(side !== undefined && { side: side as "debo" | "me_deben" | null }),
    });
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, due: client.actionableDue?.[ticketId] ?? null, estimateMinutes: client.actionableEstimate?.[ticketId] ?? null });
  }

  if (body.actionable) {
    const change = body.actionable;
    let parsed: ActionableChange;
    if (change.op === "remove" && typeof change.id === "string") {
      parsed = change;
    } else if ((change.op === "add" || change.op === "edit") && typeof change.title === "string" && change.title.trim()) {
      const title = change.title.trim().slice(0, 500);
      if (change.op === "edit") {
        if (typeof change.id !== "string") return Response.json({ error: "invalid_actionable" }, { status: 400 });
        parsed = { op: "edit", id: change.id, title };
      } else {
        // Sin "[Dueño]" el punto es mío: con el prefijo se ubica "De nuestro lado" en los mails.
        const alias = (await getSettings()).ownerAliases[0];
        parsed = {
          op: "add",
          title: title.startsWith("[") || !alias ? title : `[${alias}] ${title}`,
        };
      }
    } else {
      return Response.json({ error: "invalid_actionable" }, { status: 400 });
    }
    const result = await changeActionable(decodeURIComponent(id), parsed);
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: result.client.id, ticketId: result.ticketId });
  }

  if (body.profile && typeof body.profile === "object") {
    const p = body.profile;
    const patch: Partial<ClientProfile> = {};
    for (const k of ["emailName", "erp", "ownerEmail", "notes"] as const) {
      if (typeof p[k] === "string") patch[k] = p[k].slice(0, 2000);
    }
    if (typeof p.attention === "boolean") patch.attention = p.attention;
    // Dominios / mails vinculados (partners, devs externos): "dominio.com" o "persona@dominio.com".
    if (Array.isArray(p.linkedContacts)) {
      const seen = new Set<string>();
      patch.linkedContacts = p.linkedContacts
        .map((l) => ({ value: String(l?.value ?? "").trim().toLowerCase().replace(/^@/, ""), shared: l?.shared === true }))
        .filter((l) => /^([^\s@]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(l.value) && !seen.has(l.value) && seen.add(l.value))
        .slice(0, 30);
    }
    // Posponer en el Pulso de cuentas: "tomorrow" = hasta el próximo día hábil, "interaction" = hasta la próxima
    // interacción, null = volver a mostrar.
    if (p.followupSnooze === null) patch.followupSnooze = undefined;
    else if (p.followupSnooze === "tomorrow" || p.followupSnooze === "interaction") {
      const now = new Date();
      let until: string | undefined;
      if (p.followupSnooze === "tomorrow") {
        const { workDays } = await getSettings();
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        do d.setDate(d.getDate() + 1);
        while (!workDays.includes(d.getDay()));
        until = d.toISOString();
      }
      patch.followupSnooze = { at: now.toISOString(), ...(until && { until }) };
    }
    if (p.referentOverrides && typeof p.referentOverrides === "object") {
      patch.referentOverrides = Object.fromEntries(
        Object.entries(p.referentOverrides)
          .filter(([, v]) => typeof v === "boolean")
          .map(([k, v]) => [k.toLowerCase(), v]),
      );
    }
    if (p.contactNames && typeof p.contactNames === "object") {
      patch.contactNames = Object.fromEntries(
        Object.entries(p.contactNames)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k.toLowerCase(), v.slice(0, 120)]),
      );
    }
    let client = await updateClientProfile(decodeURIComponent(id), patch);
    if (client && typeof body.name === "string" && body.name.trim()) {
      client = await updateClient(client.id, { name: body.name.trim() });
    }
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, name: client.name, profile: client.profile });
  }

  if (typeof body.ticketId === "string" && typeof body.isDone === "boolean") {
    const client = await setTicketDone(decodeURIComponent(id), body.ticketId, body.isDone);
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({
      id: client.id,
      doneTicketIds: client.doneTicketIds,
      doneAt: client.doneTicketAt?.[body.ticketId] ?? null,
    });
  }

  const patch: Parameters<typeof updateClient>[1] = {};
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();

  const client = await updateClient(decodeURIComponent(id), patch);
  if (!client) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ id: client.id, status: client.status, name: client.name });
}
