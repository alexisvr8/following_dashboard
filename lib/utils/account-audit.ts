import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import type { AnalysisThread } from "@/lib/llm/account-analysis";
import type { AccountAuditOutput } from "@/lib/llm/account-audit-schema";
import { executedHistory } from "@/lib/utils/actionables";
import { plannedItems, type PlannedItem } from "@/lib/utils/deadlines";
import { computeParticipants } from "@/lib/utils/participants";

// Partes puras de la auditoría única por cuenta (`scripts/audit-accounts.ts`): ventana, entrada del modelo, mensaje
// y propuestas pendientes para el modal "Auditoría" de /accionables. Nada de Gmail/Drive/API acá.

const DAY = 86_400_000;
/** Reuniones que entran: las últimas N dentro de `AUDIT_MEETING_DAYS`. */
export const AUDIT_MEETINGS = 3;
export const AUDIT_MEETING_DAYS = 60;
/** Mails: desde un día antes de la reunión más vieja que entra, al menos 30 días y como mucho 60. */
const MAIL_MIN_DAYS = 30;
const MAIL_MAX_DAYS = 60;

export const OWN_DEV_RULES =
  "El PM desarrolla él mismo las integraciones con Finnegans y el archivo de importación de Algoritmo (esas tareas técnicas son debo, responsable el PM). Para el resto de las cuentas no hay regla: deducí de reuniones y mails quién desarrolla (el PM, otro dev de Xtract, el cliente o un partner) y, si no está claro, preguntá.";

export function auditMeetings(client: ClientRecord, now: Date): DiscoveredMeeting[] {
  return [...client.meetings]
    .filter((m) => Date.parse(m.date) >= now.getTime() - AUDIT_MEETING_DAYS * DAY && Date.parse(m.date) <= now.getTime())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, AUDIT_MEETINGS);
}

export function auditMailSince(meetings: DiscoveredMeeting[], now: Date): Date {
  const oldest = meetings.at(-1);
  const from = oldest ? Math.min(Date.parse(oldest.date) - DAY, now.getTime() - MAIL_MIN_DAYS * DAY) : now.getTime() - MAIL_MIN_DAYS * DAY;
  return new Date(Math.max(from, now.getTime() - MAIL_MAX_DAYS * DAY));
}

export interface AuditMeetingDoc {
  id: string;
  title: string;
  date: string;
  durationMinutes: number | null;
  notes: string | null;
  transcript: string | null;
  /** Se cortó la transcripción por el tope de texto. */
  cut?: boolean;
}

export interface AuditInput {
  clientName: string;
  today: string;
  erp: string | null;
  notes: string | null;
  attention: boolean;
  ownerName: string;
  devRules: string;
  nextMeeting: string | null;
  participants: string[];
  meetings: AuditMeetingDoc[];
  threads: AnalysisThread[];
  partnerThreads: AnalysisThread[];
  board: { ref: string; line: string }[];
  closed: string[];
}

const KIND_LABEL: Record<PlannedItem["kind"], string> = {
  step: "de minuta",
  custom: "agregado a mano",
  followup: "enviar minuta (automático)",
  reply: "responder mail (automático)",
  request: "pedido por mail",
  commitment: "compromiso por mail",
};
const dm = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
const dmy = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Tablero de la cuenta con refs A1… (mismo orden que el plan) y su mapa ref → ticket. */
export function auditBoard(client: ClientRecord, settings: WorkSettings, now: Date, nextMeetingAt: string | null) {
  const items = plannedItems([{ ...client, status: "assigned" }], settings, now, new Map(nextMeetingAt ? [[client.id, nextMeetingAt]] : []));
  const refs: Record<string, string> = {};
  const texts: Record<string, string> = {};
  const board = items.map((it, i) => {
    const ref = `A${i + 1}`;
    refs[ref] = it.id;
    texts[ref] = it.fullText;
    const origin = `${it.originKind === "mail" ? "Mail" : "Reunión"} «${it.originTitle}» ${dm(it.originDate)}`;
    const extra = [it.aiAdded ? `agregado por IA (${it.evidence ?? "sin evidencia"})` : "", it.sideManual ? "lado puesto a mano" : "", it.carried ? "arrastrado de una minuta previa" : ""]
      .filter(Boolean)
      .join(" · ");
    return {
      ref,
      line: `${ref} | ${it.side} | ${it.owners.join(", ") || "sin responsable"} | ${it.title}${it.detail ? `: ${it.detail}` : ""} | plazo ${it.dueLabel} (${it.dueKind}) | ${KIND_LABEL[it.kind]} | origen ${origin}${extra ? ` | ${extra}` : ""}`,
    };
  });
  return { items, refs, texts, board };
}

export function buildAuditInput(
  client: ClientRecord,
  settings: WorkSettings,
  ownerEmail: string | null,
  now: Date,
  nextMeetingAt: string | null,
  meetings: AuditMeetingDoc[],
  threads: AnalysisThread[],
  partnerThreads: AnalysisThread[],
): { input: AuditInput; refs: Record<string, string>; texts: Record<string, string> } {
  const { refs, texts, board } = auditBoard(client, settings, now, nextMeetingAt);
  const role = { owner: "PM (yo)", team: "equipo Xtract", referent: "referente del cliente", external: "externo" } as const;
  const participants = computeParticipants(client, ownerEmail)
    .filter((p) => p.meetingCount > 0 || p.role === "referent")
    .map((p) => `${p.customName ?? p.name ?? "(sin nombre)"} <${p.email}> · ${role[p.role]} · ${p.meetingCount} reuniones`);
  const closed = executedHistory(client)
    .filter((h) => Date.parse(h.doneAt) >= now.getTime() - AUDIT_MEETING_DAYS * DAY)
    .slice(0, 60)
    .map((h) => `- ${h.title} (hecho ${dm(h.doneAt)}, origen ${h.meetingTitle})`);
  return {
    refs,
    texts,
    input: {
      clientName: client.profile?.emailName || client.name,
      today: dmy(now.toISOString()),
      erp: client.profile?.erp ?? null,
      notes: client.profile?.notes ?? null,
      attention: Boolean(client.profile?.attention),
      ownerName: settings.ownerAliases[0] ?? "Alexis Vásquez R",
      devRules: OWN_DEV_RULES,
      nextMeeting: nextMeetingAt ? dmy(nextMeetingAt) : null,
      participants,
      meetings,
      threads,
      partnerThreads,
      board,
      closed,
    },
  };
}

const block = (tag: string, lines: string[]) => (lines.length ? `<${tag}>\n${lines.join("\n")}\n</${tag}>` : `<${tag}>(nada)</${tag}>`);

const renderThreads = (threads: AnalysisThread[]) =>
  threads.flatMap((t, i) => [
    `## Hilo ${i + 1}: ${t.subject}`,
    ...t.messages.map(
      (m) => `--- ${dmy(m.date)} · ${m.who.toUpperCase()} · ${m.fromName ? `${m.fromName} <${m.from}>` : m.from} → ${m.to.join(", ") || "-"}\n${m.text.trim() || "(sin texto)"}`,
    ),
    "",
  ]);

export function buildAuditMessage(input: AuditInput): string {
  const cuenta = [
    `Cliente: ${input.clientName}`,
    `Nuestra empresa: Xtract`,
    `PM (yo): ${input.ownerName}`,
    `Hoy: ${input.today}`,
    `ERP cargado en la app: ${input.erp ?? "(no cargado)"}`,
    `Próxima reunión agendada: ${input.nextMeeting ?? "ninguna"}`,
    ...(input.attention ? ["Cuenta marcada MÁS ATENCIÓN (cliente exigente)"] : []),
    ...(input.notes ? [`Notas del PM: ${input.notes}`] : []),
    `Reglas del PM sobre quién desarrolla: ${input.devRules}`,
  ];
  const reuniones = input.meetings.flatMap((m, i) => [
    `## Reunión ${i + 1}: ${m.title} · ${dmy(m.date)}${m.durationMinutes ? ` · ${m.durationMinutes} min` : ""}`,
    "### Notas de Gemini",
    m.notes?.trim() || "(sin notas)",
    "### Transcripción",
    m.transcript?.trim() ? `${m.transcript.trim()}${m.cut ? "\n[… transcripción cortada por tamaño]" : ""}` : "(sin transcripción)",
    "",
  ]);
  return [
    block("cuenta", cuenta),
    block("participantes", input.participants),
    block("reuniones", reuniones),
    block("mails", renderThreads(input.threads)),
    block("hilos_partner", renderThreads(input.partnerThreads)),
    block("tablero", input.board.map((b) => b.line)),
    block("cerrados", input.closed),
  ].join("\n\n");
}

/* ---------- Propuestas para el modal (serializables) ---------- */

export type AuditProposalKind = "done" | "remove" | "side" | "edit" | "due" | "add" | "profile" | "question";

export interface AuditProposal {
  /** `${clientId}|${key}` */
  id: string;
  key: string;
  clientId: string;
  clientName: string;
  kind: AuditProposalKind;
  ref: string | null;
  ticketId: string | null;
  /** Texto actual del accionable (si aplica). */
  current: string | null;
  /** Qué se propone, legible. */
  proposal: string;
  confianza: "alta" | "media" | "baja";
  evidencia: string;
  motivo: string;
  /** Datos para aplicar (según el tipo). */
  apply?: {
    side?: "debo" | "me_deben";
    title?: string;
    due?: string | null;
    doneAt?: string | null;
    developer?: { who: string; detail: string };
    erp?: string;
  };
}

export interface AuditAccountView {
  clientId: string;
  clientName: string;
  generatedAt: string;
  resumen: string;
  etapa: string;
  desarrollo: AccountAuditOutput["cuenta"]["desarrollo"];
  rolPm: AccountAuditOutput["cuenta"]["rol_pm"];
  proximoPaso: string;
  erp: AccountAuditOutput["cuenta"]["erp"];
  contactos: AccountAuditOutput["contactos"];
  /** Veredictos "vigente" sin cambios (para mostrar el conteo). */
  unchanged: number;
  proposals: AuditProposal[];
  resolvedCount: number;
}

const OWNER_PREFIX = /^\s*\[[^\]]+\]\s*/;
const strip = (s: string) => s.replace(OWNER_PREFIX, "");

/** "dd/mm" → AAAA-MM-DD, el año que deja la fecha más cerca de `ref` (no a más de ~6 meses). */
export function ddmmNear(ddmm: string | null, ref: Date): string | null {
  const m = ddmm?.match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const [d, mo] = [Number(m[1]), Number(m[2])];
  let best: Date | null = null;
  for (const y of [ref.getFullYear() - 1, ref.getFullYear(), ref.getFullYear() + 1]) {
    const c = new Date(y, mo - 1, d, 12);
    if (!best || Math.abs(c.getTime() - ref.getTime()) < Math.abs(best.getTime() - ref.getTime())) best = c;
  }
  return best ? `${best.getFullYear()}-${String(best.getMonth() + 1).padStart(2, "0")}-${String(best.getDate()).padStart(2, "0")}` : null;
}

/**
 * Todas las propuestas de la auditoría de una cuenta, contra el estado ACTUAL (un accionable que ya cerraste o
 * cambió de texto desde la auditoría no se propone). Las resueltas quedan fuera.
 */
export function auditView(client: ClientRecord, settings: WorkSettings, now = new Date()): AuditAccountView | null {
  const a = client.audit;
  if (!a) return null;
  const out = a.output;
  const items = plannedItems([{ ...client, status: "assigned" }], settings, now, new Map());
  const open = new Map(items.map((it) => [it.id, it]));
  const resolved = a.resolved ?? {};
  const generated = new Date(a.generatedAt);
  const proposals: AuditProposal[] = [];
  const push = (p: Omit<AuditProposal, "id" | "clientId" | "clientName">) => {
    if (resolved[p.key]) return;
    proposals.push({ ...p, id: `${client.id}|${p.key}`, clientId: client.id, clientName: client.name });
  };
  let unchanged = 0;
  const me = settings.ownerAliases[0] ?? "";

  // Perfil: quién desarrolla y ERP.
  const dev = out.cuenta.desarrollo;
  if (dev.quien !== "no_claro" && client.profile?.developer?.who !== dev.quien) {
    push({
      key: "profile:developer",
      kind: "profile",
      ref: null,
      ticketId: null,
      current: client.profile?.developer ? `${client.profile.developer.who}: ${client.profile.developer.detail}` : null,
      proposal: `Desarrolla: ${DEV_LABEL[dev.quien]} · ${dev.detalle} (rol del PM: ${out.cuenta.rol_pm})`,
      confianza: dev.confianza,
      evidencia: dev.evidencia,
      motivo: "Quién desarrolla define si sus tareas son Accionar o Seguimiento.",
      apply: { developer: { who: dev.quien, detail: `${dev.detalle} · rol PM: ${out.cuenta.rol_pm}` } },
    });
  }
  const erp = out.cuenta.erp.valor?.trim();
  if (erp && erp.toLowerCase() !== (client.profile?.erp ?? "").trim().toLowerCase()) {
    push({
      key: "profile:erp",
      kind: "profile",
      ref: null,
      ticketId: null,
      current: client.profile?.erp ?? null,
      proposal: `ERP: ${erp}`,
      confianza: "media",
      evidencia: out.cuenta.erp.evidencia,
      motivo: client.profile?.erp ? "El ERP cargado no coincide con lo que se habla." : "La cuenta no tiene ERP cargado.",
      apply: { erp },
    });
  }

  for (const v of out.accionables) {
    const ticketId = a.refs[v.ref];
    const it = ticketId ? open.get(ticketId) : undefined;
    // Ya cerrado/quitado, o cambió el texto desde la auditoría: la propuesta perdió vigencia.
    if (!ticketId || !it || (a.refTexts[v.ref] != null && a.refTexts[v.ref] !== it.fullText)) continue;
    const current = it.fullText;
    const base = { ref: v.ref, ticketId, current, confianza: v.confianza, evidencia: v.evidencia, motivo: v.motivo };
    if (v.veredicto === "hecho") {
      push({ ...base, key: `${v.ref}:done`, kind: "done", proposal: `Marcar hecho${v.fecha_hecho ? ` (${v.fecha_hecho})` : ""}`, apply: { doneAt: ddmmNear(v.fecha_hecho, generated) } });
      continue;
    }
    if (v.veredicto === "duplicado" || v.veredicto === "no_corresponde") {
      if (!it.removable) continue;
      const dupOf = v.duplicado_de ? a.refTexts[v.duplicado_de] : null;
      push({
        ...base,
        key: `${v.ref}:remove`,
        kind: "remove",
        proposal: v.veredicto === "duplicado" ? `Quitar: duplicado de ${v.duplicado_de}${dupOf ? ` «${strip(dupOf)}»` : ""}` : "Quitar: no corresponde",
      });
      continue;
    }
    if (v.veredicto === "dudoso") continue; // va como pregunta
    let changed = false;
    if (v.lado !== it.side) {
      changed = true;
      push({ ...base, key: `${v.ref}:side`, kind: "side", proposal: `Pasar a ${v.lado === "debo" ? "Accionar" : "Seguimiento"}${v.responsable ? ` (responsable: ${v.responsable})` : ""}`, apply: { side: v.lado } });
    }
    if (v.reescritura && it.editable) {
      changed = true;
      const ownerPrefix = it.editable === "step" ? (v.responsable.trim() ? `[${v.responsable.trim()}] ` : (current.match(OWNER_PREFIX)?.[0] ?? "")) : "";
      const body = v.reescritura.descripcion.trim() ? `${v.reescritura.titulo.trim()}: ${v.reescritura.descripcion.trim()}` : v.reescritura.titulo.trim();
      const title = `${ownerPrefix}${body}`;
      push({ ...base, key: `${v.ref}:edit`, kind: "edit", proposal: title, apply: { title } });
    }
    const due = ddmmNear(v.fecha_acordada, generated);
    if (due && it.dueKind !== "manual" && due !== it.due.slice(0, 10)) {
      changed = true;
      push({ ...base, key: `${v.ref}:due`, kind: "due", proposal: `Fecha acordada: ${v.fecha_acordada}`, apply: { due } });
    }
    if (!changed) unchanged++;
  }

  out.faltantes.forEach((f, i) => {
    const owner = f.responsable.trim() || (f.lado === "debo" ? me : "");
    const body = f.descripcion.trim() ? `${f.titulo.trim()}: ${f.descripcion.trim()}` : f.titulo.trim();
    const title = `${owner ? `[${owner}] ` : ""}${body}`;
    push({
      key: `add:${i}`,
      kind: "add",
      ref: null,
      ticketId: null,
      current: null,
      proposal: title,
      confianza: f.confianza,
      evidencia: f.evidencia,
      motivo: `${f.lado === "debo" ? "Accionar" : "Seguimiento"}${f.fecha ? ` · fecha ${f.fecha}` : ""}`,
      apply: { title, side: f.lado, due: ddmmNear(f.fecha, generated) },
    });
  });

  out.preguntas.forEach((q, i) => {
    const ticketId = q.ref ? a.refs[q.ref] : null;
    if (ticketId && !open.has(ticketId)) return; // el accionable ya se cerró
    push({
      key: `q:${i}`,
      kind: "question",
      ref: q.ref,
      ticketId: ticketId ?? null,
      current: q.ref ? (a.refTexts[q.ref] ?? null) : null,
      proposal: q.pregunta,
      confianza: "baja",
      evidencia: q.contexto,
      motivo: q.tipo,
    });
  });

  return {
    clientId: client.id,
    clientName: client.name,
    generatedAt: a.generatedAt,
    resumen: out.cuenta.resumen,
    etapa: out.cuenta.etapa,
    desarrollo: out.cuenta.desarrollo,
    rolPm: out.cuenta.rol_pm,
    proximoPaso: out.cuenta.proximo_paso,
    erp: out.cuenta.erp,
    contactos: out.contactos,
    unchanged,
    proposals,
    resolvedCount: Object.keys(resolved).length,
  };
}

export const DEV_LABEL: Record<AccountAuditOutput["cuenta"]["desarrollo"]["quien"], string> = {
  pm: "yo (PM)",
  equipo_xtract: "otro dev de Xtract",
  cliente: "el cliente",
  partner: "un partner",
  mixto: "mixto",
  no_claro: "no claro",
};

/** Vistas de todas las cuentas asignadas con auditoría y algo pendiente. */
export function pendingAudit(clients: ClientRecord[], settings: WorkSettings, now = new Date()): AuditAccountView[] {
  return clients
    .filter((c) => c.status === "assigned" && c.audit)
    .flatMap((c) => {
      const v = auditView(c, settings, now);
      return v && v.proposals.length ? [v] : [];
    });
}
