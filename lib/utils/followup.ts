import {
  followupKey,
  type ClientRecord,
  type DiscoveredMeeting,
  type FollowupDraft,
  type FollowupKind,
} from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { computeParticipants } from "@/lib/utils/participants";
import { isOwnActionable } from "@/lib/utils/capacity";
import { mailTickets } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";

// Borrador de follow-up post-reunión (por reglas, sin LLM): resumen + próximos pasos de la
// minuta de Gemini. Se genera al vuelo apenas llega la minuta; se persiste solo al editarlo
// o al crear el draft en Gmail (`client.followups[meetingId]`).

const fmtShort = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "2-digit" });

function mondayStart(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

/** "[Ana Pérez] Enviar X: detalle" → "Enviar X: detalle (Ana Pérez)". */
function formatStep(step: string): string {
  const m = step.match(/^\s*\[([^\]]+)\]\s*(.+)$/);
  return m ? `${m[2].trim()} (${m[1].trim()})` : step.trim();
}

/** Referentes que asistieron a la reunión (fallback: todos los referentes de la cuenta). */
export function followupRecipients(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
): { email: string; name: string | null }[] {
  const referents = computeParticipants(client, ownerEmail).filter((p) => p.role === "referent");
  const attended = new Set((meeting.attendees ?? []).map((a) => a.email.toLowerCase()));
  const inMeeting = referents.filter((p) => attended.has(p.email));
  const mailNames = new Map(
    (client.activity?.recentMails ?? client.activity?.recentInbound ?? [])
      .filter((m) => m.fromName)
      .map((m) => [m.from, m.fromName!]),
  );
  return (inMeeting.length ? inMeeting : referents).map((p) => ({
    email: p.email,
    name: p.name ?? mailNames.get(p.email) ?? null,
  }));
}

const normName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1);

/**
 * De qué lado está un accionable "[Nombre] …": mío (alias), equipo propio (participante del
 * dominio propio con ese nombre), cliente (referente/externo) o desconocido.
 */
export function stepSide(
  step: string,
  client: ClientRecord,
  ownerEmail: string | null,
  settings: WorkSettings,
): "me" | "team" | "client" | "unknown" {
  const owner = step.match(/^\s*\[([^\]]+)\]/)?.[1];
  if (isOwnActionable(step, settings)) return owner ? "me" : "unknown";
  if (!owner) return "unknown";
  const target = normName(owner);
  const people = computeParticipants(client, ownerEmail);
  const mailNames = new Map(
    (client.activity?.recentMails ?? []).filter((m) => m.fromName).map((m) => [m.from, m.fromName!]),
  );
  const hit = people.find((p) => {
    const n = normName(p.name ?? mailNames.get(p.email) ?? p.email.split("@")[0].replace(/[._]/g, " "));
    const shared = target.filter((w) => n.includes(w)).length;
    return shared >= Math.min(2, target.length);
  });
  if (!hit) return "unknown";
  return hit.role === "team" || hit.role === "owner" ? "team" : "client";
}

function greet(recipients: { name: string | null }[]): string {
  const firstNames = [...new Set(recipients.map((r) => r.name?.split(/\s+/)[0]).filter(Boolean))];
  return firstNames.length
    ? `Hola ${firstNames.length > 1 ? `${firstNames.slice(0, -1).join(", ")} y ${firstNames.at(-1)}` : firstNames[0]},`
    : "Hola equipo,";
}

export function buildFollowup(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
): FollowupDraft {
  const saved = client.followups?.[followupKey("meeting", meeting.id)];
  if (saved) return saved;

  const recipients = followupRecipients(client, meeting, ownerEmail);
  const greeting = greet(recipients);

  const lines = [
    greeting,
    "",
    `Gracias por el tiempo en la reunión del ${fmtDate(meeting.date)}. Les comparto un resumen de lo conversado:`,
    "",
    meeting.summary ?? "(completar resumen)",
  ];
  if (meeting.nextSteps.length) {
    lines.push("", "Próximos pasos:", ...meeting.nextSteps.map((s) => `• ${formatStep(s)}`));
  }
  lines.push("", "Si algo no quedó bien reflejado, avísenme y lo corregimos.", "", "Saludos,");

  return {
    meetingId: meeting.id,
    subject: `Resumen y próximos pasos – ${meeting.title}`,
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mail de actualización/seguimiento sobre lo acordado en la última reunión, según el estado
 * actual de los accionables (tildados = completados) y, si el último mail es del cliente, sus
 * pedidos. Pensado para no dejar pasar más de N días hábiles sin novedades.
 */
export function buildStatusUpdate(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): FollowupDraft {
  const done = new Set(client.doneTicketIds ?? []);
  const now = new Date();
  const weekStart = mondayStart(now);
  const steps = accountActionables(client).map((a) => ({
    ...a,
    text: formatStep(a.step),
    side: stepSide(a.step, client, ownerEmail, settings),
  }));
  // Completado esta semana = con fecha de cierre ≥ lunes. Sin fecha (cerrados antes de registrar
  // fechas) y de la última minuta = "completado previamente".
  const completedWeek = steps
    .filter((s) => s.done && s.doneAt && Date.parse(s.doneAt) >= weekStart.getTime())
    .sort((a, b) => a.doneAt!.localeCompare(b.doneAt!));
  const completedBefore = steps.filter((s) => s.done && !s.doneAt && !s.carried);
  const open = steps.filter((s) => !s.done);
  const tag = (s: (typeof steps)[number]) => (s.carried ? ` [acordado el ${fmtShort(s.meeting.date)}]` : "");
  const ours = open.filter((s) => s.side === "me" || s.side === "team");
  const theirs = open.filter((s) => s.side === "client");
  const other = open.filter((s) => s.side === "unknown");
  const lastMail = client.activity?.lastMail;
  const fromClient = lastMail?.direction === "client" ? lastMail : null;
  const requests = mailTickets(client).filter((t) => !t.id.endsWith("-reply") && !done.has(t.id));
  const recipients = followupRecipients(client, meeting, ownerEmail);

  const lines = [greet(recipients), ""];
  if (fromClient && fromClient.date > meeting.date) {
    lines.push(`Gracias por tu mail del ${fmtDate(fromClient.date)} (“${fromClient.subject}”).`, "");
  }
  lines.push(
    open.length
      ? `Les comparto una actualización del avance sobre lo acordado en la reunión del ${fmtDate(meeting.date)}:`
      : `Les comparto el cierre de lo acordado en la reunión del ${fmtDate(meeting.date)}: completamos todos los puntos.`,
  );
  if (completedWeek.length) {
    lines.push(
      "",
      "Completado esta semana:",
      ...completedWeek.map((s) => `✓ ${s.text}${s.doneAt ? ` (${fmtShort(s.doneAt)})` : ""}`),
    );
  }
  if (completedBefore.length) lines.push("", "Completado previamente:", ...completedBefore.map((s) => `✓ ${s.text}`));
  if (ours.length) lines.push("", "En curso de nuestro lado:", ...ours.map((s) => `• ${s.text}${tag(s)} — (completar estado / fecha estimada)`));
  if (requests.length) lines.push("", "Sobre lo que nos consultaron:", ...requests.map((r) => `• ${r.title} → (completar respuesta)`));
  if (theirs.length) lines.push("", "Pendiente de su lado (para poder avanzar):", ...theirs.map((s) => `• ${s.text}${tag(s)}`));
  if (other.length) lines.push("", "Otros pendientes acordados:", ...other.map((s) => `• ${s.text}${tag(s)}`));
  lines.push("", "Cualquier duda o si hay algo para priorizar, me avisan.", "", "Saludos,");

  return {
    meetingId: meeting.id,
    subject: `Actualización de avance – ${client.name}`,
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    updatedAt: new Date().toISOString(),
  };
}

/** Borrador guardado (si existe y sigue vigente) o recién generado, según el tipo. */
export function getDraft(
  kind: FollowupKind,
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): { draft: FollowupDraft; generated: FollowupDraft; regenerated: boolean } {
  const generated =
    kind === "status"
      ? buildStatusUpdate(client, meeting, ownerEmail, settings)
      : buildFollowup({ ...client, followups: {} }, meeting, ownerEmail);
  const saved = client.followups?.[followupKey(kind, meeting.id)];
  // Seguimiento: si se tildaron/destildaron accionables o hubo mails nuevos después de la
  // edición guardada, se regenera con el estado actual (conserva destinatarios editados).
  const changedAt = [client.ticketsUpdatedAt, client.activity?.lastMail?.date].filter(Boolean).sort().at(-1);
  if (kind === "status" && saved && changedAt && changedAt > saved.updatedAt) {
    return { draft: { ...generated, to: saved.to.length ? saved.to : generated.to }, generated, regenerated: true };
  }
  return { draft: saved ?? generated, generated, regenerated: false };
}
