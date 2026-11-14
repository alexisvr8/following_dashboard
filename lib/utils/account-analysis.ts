import { ddmmToIso, type AnalysisNewItem, type ClientRecord, type DiscoveredMeeting } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import type { AnalysisBasis, AnalysisInput, AnalysisThread } from "@/lib/llm/account-analysis";
import type { AccountAnalysisOutput } from "@/lib/llm/account-analysis-schema";
import { accountActionables, executedHistory, stepTicketId } from "@/lib/utils/actionables";
import { plannedItems } from "@/lib/utils/deadlines";
import { isOwnActionable } from "@/lib/utils/capacity";

// Partes puras del análisis semanal por cuenta (sin Gmail ni API): base y período, entrada del modelo y
// accionables nuevos a agregar. La orquestación vive en `lib/integrations/account-analysis.ts`.

const DAY = 86_400_000;
/** Reunión en los últimos N días ⇒ la minuta es la base del análisis. */
export const MEETING_BASIS_DAYS = 7;
const CLOSED_DAYS = 14;

export const OWN_COMPANY = "Xtract";

/** Lunes de la semana de `d` (AAAA-MM-DD, hora local). */
export function mondayKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

export const latestMeeting = (client: ClientRecord): DiscoveredMeeting | null =>
  [...client.meetings].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

/**
 * Base y período de mails: con reunión en los últimos 7 días, la minuta manda y se leen los mails desde un día
 * antes de la reunión (mínimo 14 días). Sin reunión reciente, la trazabilidad de mails manda: desde la última
 * reunión (al menos 21 días, como mucho 45).
 */
export function analysisWindow(client: ClientRecord, now: Date): { basis: AnalysisBasis; since: Date; meeting: DiscoveredMeeting | null } {
  const meeting = latestMeeting(client);
  const t = now.getTime();
  const meetingAt = meeting ? Date.parse(meeting.date) : null;
  if (meetingAt != null && t - meetingAt <= MEETING_BASIS_DAYS * DAY) {
    return { basis: "reunion", since: new Date(Math.min(meetingAt - DAY, t - 14 * DAY)), meeting };
  }
  const from = meetingAt != null ? Math.min(meetingAt - DAY, t - 21 * DAY) : t - 30 * DAY;
  return { basis: "mails", since: new Date(Math.max(from, t - 45 * DAY)), meeting };
}

const longDate = (d: Date) => d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const shortDate = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const DUE_KIND_LABEL = { manual: "manual", agreed: "acordada", target: "meta interna" } as const;

export function buildAnalysisInput(
  client: ClientRecord,
  settings: WorkSettings,
  threads: AnalysisThread[],
  now: Date,
  nextMeetingAt: string | null,
): { input: AnalysisInput; refs: Record<string, string>; refTexts: Record<string, string>; rewritable: string[]; existing: string[] } {
  const { basis, since, meeting } = analysisWindow(client, now);
  const done = new Set(client.doneTicketIds ?? []);
  const items = plannedItems([{ ...client, status: "assigned" }], settings, now, new Map(nextMeetingAt ? [[client.id, nextMeetingAt]] : []));
  const refs: Record<string, string> = {};
  const open = items.map((it, i) => {
    const ref = `A${i + 1}`;
    refs[ref] = it.id;
    return {
      ref,
      title: it.title,
      detail: it.detail,
      side: it.side,
      owners: it.owners,
      due: `${it.dueLabel} (${DUE_KIND_LABEL[it.dueKind]})`,
      rewritable: it.editable === "step",
      origin: `${it.originKind === "mail" ? "" : "Reunión: "}${it.originTitle} ${new Date(it.originDate).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}${it.kind === "custom" ? " (agregado a mano)" : ""}`,
    };
  });
  const closed = executedHistory(client)
    .filter((h) => Date.parse(h.doneAt) >= now.getTime() - CLOSED_DAYS * DAY)
    .slice(0, 30)
    .map((h) => ({ title: h.title, doneAt: h.doneAt }));
  const steps = new Map(accountActionables(client).map((a) => [a.id, a.step]));
  const refTexts = Object.fromEntries(Object.entries(refs).flatMap(([ref, id]) => (steps.has(id) ? [[ref, steps.get(id)!]] : [])));
  return {
    refs,
    refTexts,
    rewritable: open.filter((o) => o.rewritable).map((o) => o.ref),
    existing: items.map((it) => it.fullText),
    input: {
      clientName: client.profile?.emailName || client.name,
      ownCompany: OWN_COMPANY,
      ownerName: settings.ownerAliases[0] ?? "Alexis Vásquez R",
      today: longDate(now),
      erp: client.profile?.erp ?? null,
      manualPriority: client.profile?.priority ?? null,
      attention: Boolean(client.profile?.attention),
      notes: client.profile?.notes ?? null,
      basis,
      periodFrom: shortDate(since),
      nextMeeting: nextMeetingAt ? longDate(new Date(nextMeetingAt)) : null,
      meeting: meeting
        ? {
            title: meeting.title,
            date: meeting.date,
            objetivo: meeting.ai?.objetivo ?? null,
            puntos: meeting.ai?.puntos ?? meeting.milestones ?? [],
            charlamos: meeting.ai?.charlamos ?? (meeting.decisions ?? []).map((d) => d.text),
            summary: meeting.summary,
            steps: meeting.nextSteps.map((text, i) => ({
              text: client.actionableEdits?.[stepTicketId(client.id, meeting.id, i)] ?? text,
              done: done.has(stepTicketId(client.id, meeting.id, i)),
            })),
          }
        : null,
      open,
      closed,
      threads,
    },
  };
}

/** Accionables nuevos (ref null) del análisis → items para `setAccountAnalysis`. */
export function newItemsFromAnalysis(
  output: AccountAnalysisOutput,
  settings: WorkSettings,
  since: Date,
): AnalysisNewItem[] {
  const me = settings.ownerAliases[0] ?? "";
  return output.accionables_semana
    .filter((a) => a.ref == null && a.titulo.trim())
    .map((a) => {
      const owner = a.responsable.trim() || (a.lado === "debo" ? me : "");
      const body = a.descripcion.trim() ? `${a.titulo.trim()}: ${a.descripcion.trim()}` : a.titulo.trim();
      const text = `${owner ? `[${owner}] ` : ""}${body}`;
      return {
        text,
        // Fecha dicha en un mail/reunión del período: se resuelve desde el inicio del período (puede estar vencida).
        due: ddmmToIso(a.fecha, since.toISOString()),
        side: a.lado,
        detectedSide: isOwnActionable(text, settings) ? "debo" : "me_deben",
        evidence: a.evidencia,
        minutes: a.lado === "debo" ? roundMinutes(a.minutos_estimados) : 0,
      };
    });
}

/** Minutos de la IA → múltiplo de 5 entre 5 y 480 (0 = sin estimación). */
export const roundMinutes = (m: number) => (m > 0 ? Math.min(480, Math.max(5, Math.round(m / 5) * 5)) : 0);

/** Estimaciones de la IA para accionables existentes (ref → ticket), solo lado debo. */
export function estimatesFromAnalysis(output: AccountAnalysisOutput, refs: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    output.accionables_semana.flatMap((a) => {
      const id = a.ref ? refs[a.ref] : undefined;
      const m = a.lado === "debo" ? roundMinutes(a.minutos_estimados) : 0;
      return id && m ? [[id, m]] : [];
    }),
  );
}

/** Deja solo refs que existen (el modelo puede inventar "A99"). */
export function sanitizeRefs(
  output: AccountAnalysisOutput,
  refs: Record<string, string>,
  rewritable: string[] = Object.keys(refs),
): AccountAnalysisOutput {
  const canRewrite = new Set(rewritable);
  return {
    ...output,
    reescrituras: output.reescrituras.filter((r) => canRewrite.has(r.ref) && r.titulo.trim()),
    accionables_semana: output.accionables_semana.map((a) => (a.ref && !refs[a.ref] ? { ...a, ref: null } : a)),
    posibles_resueltos: output.posibles_resueltos.filter((p) => refs[p.ref]),
  };
}

export interface RewriteItem {
  /** `${clientId}|${ref}` */
  id: string;
  clientId: string;
  clientName: string;
  ref: string;
  ticketId: string;
  /** Texto actual del accionable (con "[Dueño]"). */
  current: string;
  /** Propuesta lista para guardar: "[Responsable] Título: descripción". */
  proposed: string;
  motivo: string;
  generatedAt: string;
}

const OWNER_PREFIX = /^\s*\[[^\]]+\]\s*/;

/**
 * Reescrituras del último análisis semanal aún sin resolver (modal "Mejoras IA"): solo de accionables que
 * siguen abiertos y cuyo texto no cambió desde el análisis. Sin responsable en la propuesta, se conserva el actual.
 */
export function pendingRewrites(clients: ClientRecord[]): RewriteItem[] {
  return clients
    .filter((c) => c.status === "assigned" && c.analysis?.output.reescrituras?.length)
    .flatMap((c) => {
      const analysis = c.analysis!;
      const open = new Map(accountActionables(c).filter((a) => !a.done).map((a) => [a.id, a.step]));
      return analysis.output.reescrituras.flatMap((r) => {
        const ticketId = analysis.refs[r.ref];
        const current = ticketId ? open.get(ticketId) : undefined;
        if (!current || analysis.rewritesResolved?.[r.ref]) return [];
        if (analysis.refTexts?.[r.ref] != null && analysis.refTexts[r.ref] !== current) return [];
        const owner = r.responsable.trim() ? `[${r.responsable.trim()}] ` : (current.match(OWNER_PREFIX)?.[0] ?? "");
        const body = r.descripcion.trim() ? `${r.titulo.trim()}: ${r.descripcion.trim()}` : r.titulo.trim();
        return [
          {
            id: `${c.id}|${r.ref}`,
            clientId: c.id,
            clientName: c.name,
            ref: r.ref,
            ticketId,
            current,
            proposed: `${owner.trim() ? `${owner.trim()} ` : ""}${body}`,
            motivo: r.motivo,
            generatedAt: analysis.generatedAt,
          },
        ];
      });
    });
}

const STATE_LABEL: Record<AccountAnalysisOutput["estado"], string> = {
  avanzando: "Avanzando",
  esperando_cliente: "Esperando al cliente",
  esperando_xtract: "Esperando a Xtract",
  bloqueada: "Bloqueada",
  en_riesgo: "En riesgo",
  sin_actividad: "Sin actividad",
};

export interface AnalysisView {
  generatedAt: string;
  basis: "reunion" | "mails";
  since: string;
  threadsRead: number;
  mailsRead: number;
  truncated: boolean;
  /** Hubo reunión o mail del cliente después del análisis. */
  stale: boolean;
  state: AccountAnalysisOutput["estado"];
  stateLabel: string;
  resumen: string;
  priority: AccountAnalysisOutput["prioridad"];
  lastInteraction: AccountAnalysisOutput["ultima_interaccion"];
  plan: { ref: string | null; titulo: string; descripcion: string; lado: string; responsable: string; prioridad: string; fecha: string | null; evidencia: string }[];
  resolved: { ref: string; ticketId: string; title: string; evidencia: string; done: boolean }[];
  conversations: AccountAnalysisOutput["conversaciones"];
  risks: string[];
  nextMail: string;
  review: string[];
  error: string | null;
}

/** Vista de la pestaña "Análisis IA" de la cuenta (serializable para el componente cliente). */
export function analysisView(client: ClientRecord): AnalysisView | null {
  const a = client.analysis;
  if (!a) return null;
  const steps = new Map(accountActionables(client).map((x) => [x.id, x]));
  const latest = latestMeeting(client);
  const lastClientMail = (client.activity?.recentMails ?? []).filter((m) => m.direction === "client").map((m) => m.date).sort().at(-1);
  const stale = Boolean((latest && latest.date > a.generatedAt) || (lastClientMail && lastClientMail > a.generatedAt));
  return {
    generatedAt: a.generatedAt,
    basis: a.basis,
    since: a.since,
    threadsRead: a.threadsRead,
    mailsRead: a.mailsRead,
    truncated: Boolean(a.truncated),
    stale,
    state: a.output.estado,
    stateLabel: STATE_LABEL[a.output.estado],
    resumen: a.output.resumen,
    priority: a.output.prioridad,
    lastInteraction: a.output.ultima_interaccion,
    plan: a.output.accionables_semana,
    resolved: a.output.posibles_resueltos.flatMap((r) => {
      const ticketId = a.refs[r.ref];
      const step = ticketId ? steps.get(ticketId) : undefined;
      return step ? [{ ref: r.ref, ticketId, title: step.step.replace(/^\s*\[[^\]]+\]\s*/, ""), evidencia: r.evidencia, done: step.done }] : [];
    }),
    conversations: a.output.conversaciones,
    risks: a.output.riesgos,
    nextMail: a.output.proximo_mail,
    review: a.output.revision,
    error: client.analysisError?.message ?? null,
  };
}
