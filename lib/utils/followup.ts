import {
  followupKey,
  followupTicketId,
  type ClientRecord,
  type DiscoveredMeeting,
  type FollowupDraft,
  type FollowupKind,
  type MailRef,
} from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { computeParticipants, isOwnTeamEmail, type Participant } from "@/lib/utils/participants";
import { isGroupOwner, isOwnActionable, learnedRole } from "@/lib/utils/capacity";
import { isRecapMail, mailTickets, relatedMailNote } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";
import { parseStep, type StepDue } from "@/lib/utils/gemini-notes-parser";
import { agreedDue } from "@/lib/utils/deadlines";
import {
  cleanThreadSubject,
  pickFollowupThread,
  standardSubject,
  strayClientMails,
  strayLine,
  strayNotes,
  strayParticipants,
} from "@/lib/utils/followup-thread";

// Borradores por reglas (sin LLM), recalculados con cada mail, reunión o accionable tildado.
// Follow-up: hitos, decisiones y accionables para la próxima sesión (última minuta + arrastrados +
// pedidos por mail). Seguimiento: accionables finalizados desde mi último mail posterior a la reunión,
// partiendo de la última interacción. Se persisten solo al editarlos, crear el draft en Gmail o
// enviarlos (`client.followups`). Lo que requiere revisión va en `reviewNotes`,
// nunca en el cuerpo: los borradores automáticos llegan a Gmail sin pasar por la UI.

const fmtShort = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "2-digit" });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

/** "02/11" (siempre dos dígitos: `toLocaleDateString` en "es" da "2/11"). */
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** "[Ana Pérez] Enviar X: detalle" → "Enviar X: detalle" (el responsable va al final, ver `ownerTag`). */
function formatStep(step: string): string {
  const m = step.match(/^\s*\[([^\]]+)\]\s*(.+)$/);
  return m ? m[2].trim() : step.trim();
}

const ARTICLE = /^(el|la|los|las|the)$/i;
/** Nombre de pila ("Nerina Gómez" → "Nerina"); "La empresa" / "El grupo" quedan enteros. */
const firstName = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length > 1 && !ARTICLE.test(words[0]) ? words[0] : name.trim();
};

/** " (Nerina)" / " (Sebastian y Alexis)" al final del punto, antes del status. */
export function ownerTag(step: string): string {
  const owners = step.match(/^\s*\[([^\]]+)\]/)?.[1].split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  const names = [...new Set(owners.map(firstName))];
  if (!names.length) return "";
  return ` (${names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : names[0]})`;
}

/** Responsables sin paréntesis ("Gonzalo y Alexis"); "[El grupo]" / "[Todos]" → "Equipo". */
function groupTag(step: string): string {
  const owners = step.match(/^\s*\[([^\]]+)\]/)?.[1].split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  if (owners.length && owners.every(isGroupOwner)) return "Equipo";
  return ownerTag(step).replace(/^ \((.*)\)$/, "$1");
}

/** "Carga de documentos: Gonzalo cargó…" → "Carga de documentos" (el detalle va en lo charlado). */
const milestoneTitle = (m: string) => {
  const i = m.indexOf(":");
  return i > 0 && i <= 70 ? m.slice(0, i).trim() : m.trim();
};

const senderNames = (client: ClientRecord) =>
  new Map(
    (client.activity?.recentMails ?? client.activity?.recentInbound ?? [])
      .filter((m) => m.fromName)
      .map((m) => [m.from, m.fromName!]),
  );

/**
 * Cómo nombrar la reunión según cuánto pasó: "del día de hoy", "de ayer", "del lunes" (hasta 3 días) y,
 * después, la fecha completa ("del viernes, 6 de noviembre").
 */
export function meetingWhen(iso: string, now: Date): { text: string; recent: boolean } {
  const d = new Date(iso);
  const days = Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) /
      86_400_000,
  );
  if (days <= 0) return { text: "del día de hoy", recent: true };
  if (days === 1) return { text: "de ayer", recent: true };
  if (days <= 3) return { text: `del ${d.toLocaleDateString("es", { weekday: "long" })}`, recent: true };
  return { text: `del ${fmtDate(iso)}`, recent: false };
}

// Estado al final de cada punto. En el editor es texto plano; al pasar a Gmail (`bodyToHtml`) queda
// "Status:" en negrita y "Hecho" en negrita verde.
export const STATUS_DONE = " - Status: Hecho";
export const STATUS_PENDING = " - Status: Pendiente";
/** " - Status: Hecho (02/11)" */
const doneStatus = (doneAt: string | null) => `${STATUS_DONE}${doneAt ? ` (${fmtDay(doneAt)})` : ""}`;

const cleanSubject = (subject: string) => subject.replace(/^\s*((re|fwd?|rv)\s*:\s*)+/i, "").trim();

export type Interaction =
  | { kind: "meeting"; date: string }
  | { kind: "mail"; date: string; mail: MailRef };

/** Punto de partida del seguimiento: el último mail recibido del cliente o enviado por mí, si es posterior a la reunión. */
export function latestInteraction(client: ClientRecord, meeting: DiscoveredMeeting): Interaction {
  const mail = (client.activity?.recentMails ?? [])
    .filter((m) => m.direction === "client" || m.direction === "me")
    .reduce<MailRef | null>((last, m) => (!last || m.date > last.date ? m : last), null);
  return mail && mail.date > meeting.date ? { kind: "mail", date: mail.date, mail } : { kind: "meeting", date: meeting.date };
}

/** Por accionable, el último mail posterior a la reunión que lo trata (los mails resumen no cuentan). */
function mailTrace(client: ClientRecord, meeting: DiscoveredMeeting): Map<string, MailRef> {
  const trace = new Map<string, MailRef>();
  const mails = (client.activity?.recentMails ?? [])
    .filter((m) => m.date > meeting.date && !isRecapMail(m))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const mail of mails) {
    for (const id of mail.relatedTicketIds) if (!trace.has(id)) trace.set(id, mail);
  }
  return trace;
}

/** Lo último conversado, para quien revisa: las reglas no resumen el texto, así que se muestra tal cual. */
function lastTalkNote(interaction: Interaction): string[] {
  if (interaction.kind !== "mail") return [];
  const { mail } = interaction;
  const text = mail.excerpt.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const who = mail.direction === "me" ? "Tu último mail" : `Último mail de ${mail.fromName ?? mail.from}`;
  return [`${who} (${fmtShort(mail.date)}): “${text.length > 320 ? `${text.slice(0, 320)}…` : text}”`];
}

/** Pedidos del último mail del cliente: siguen pendientes solo si ese mail es lo último; si respondí, ya los traté. */
function openRequests(client: ClientRecord, interaction: Interaction) {
  if (interaction.kind !== "mail" || interaction.mail.direction !== "client") return [];
  const done = new Set(client.doneTicketIds ?? []);
  const { messageId } = interaction.mail;
  return mailTickets(client).filter((t) => t.kind === "request" && t.messageId === messageId && !done.has(t.id));
}

/** Si parte de un mail: quienes participaron de ese mail del lado del cliente (fallback: los de la reunión). */
function interactionRecipients(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  interaction: Interaction,
  ownerEmail: string | null,
): { email: string; name: string | null }[] {
  const fallback = followupRecipients(client, meeting, ownerEmail);
  if (interaction.kind === "meeting") return fallback;
  const { mail } = interaction;
  const emails = [...new Set([...(mail.direction === "client" ? [mail.from] : []), ...(mail.recipients ?? [])])].filter(
    (e) =>
      !isOwnTeamEmail(e, ownerEmail) &&
      !isOwnTeamEmail(e, client.profile?.ownerEmail) &&
      !/^(no-?reply|notifications?)@/i.test(e),
  );
  if (!emails.length) return fallback;
  const senders = senderNames(client);
  const people = new Map(computeParticipants(client, ownerEmail).map((p) => [p.email, p.name]));
  return emails.map((email) => ({ email, name: people.get(email) ?? senders.get(email) ?? null }));
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
  const mailNames = senderNames(client);
  return (inMeeting.length ? inMeeting : referents).map((p) => ({
    email: p.email,
    name: p.name ?? mailNames.get(p.email) ?? null,
  }));
}

/** Referentes y equipo Xtract que no estén ya en "to": en copia para que todos queden al tanto del mail nuevo. */
function newMailCc(client: ClientRecord, ownerEmail: string | null, to: { email: string }[]): string[] {
  const already = new Set(to.map((r) => r.email));
  return computeParticipants(client, ownerEmail)
    .filter((p) => (p.role === "referent" || p.role === "team") && !already.has(p.email))
    .map((p) => p.email);
}

/** Cc + participantes de los hilos sueltos del cliente (sin mí ni quienes ya están en "to"). */
function withStrayCc(cc: string[], extra: string[], ownerEmail: string | null, to: { email: string }[]): string[] {
  const skip = new Set([ownerEmail?.toLowerCase(), ...to.map((r) => r.email)]);
  return [...new Set([...cc, ...extra.filter((e) => !skip.has(e) && !/^(no-?reply|notifications?)@/i.test(e))])];
}

/** Todos los que aparecieron en De/Para/Cc del hilo, salvo yo y quienes ya están en "to": "Responder a todos". */
function replyAllCc(
  client: ClientRecord,
  threadId: string,
  ownerEmail: string | null,
  to: { email: string }[],
): string[] {
  const already = new Set(to.map((r) => r.email));
  const emails = new Set<string>();
  for (const m of client.activity?.recentMails ?? []) {
    if (m.threadId !== threadId) continue;
    emails.add(m.from.toLowerCase());
    for (const r of m.recipients ?? []) emails.add(r.toLowerCase());
  }
  const me = ownerEmail?.toLowerCase();
  return [...emails].filter((e) => e !== me && !already.has(e) && !/^(no-?reply|notifications?)@/i.test(e));
}

const normName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1);

export type StepSide = "me" | "team" | "client" | "shared" | "unknown";

/** "Melani Uban" ↔ nombre "Melani", melani@…, melani.uban@… o muban@… (sin nombre en Calendar). */
function matchesPerson(target: string[], name: string | null, email: string): boolean {
  const covers = (words: string[]) =>
    words.length > 0 && target.filter((w) => words.includes(w)).length >= Math.min(2, target.length, words.length);
  if (name && covers(normName(name))) return true;
  const local = normName(email.split("@")[0].replace(/[._-]/g, " "));
  if (covers(local)) return true;
  const compact = local.join("");
  const last = target.at(-1) ?? "";
  const joined = target.join("");
  if (joined.length >= 4 && compact.startsWith(joined)) return true; // cristiankeller@, tobias123@
  return target.length >= 2 && last.length >= 4 && compact === target[0][0] + last;
}

function ownerSide(
  owner: string,
  client: ClientRecord,
  people: Participant[],
  settings: WorkSettings,
): StepSide {
  if (isGroupOwner(owner)) return "shared";
  const role = learnedRole(owner, settings);
  if (role) return role === "me" ? "me" : role === "team" ? "team" : "client";
  if (isOwnActionable(`[${owner}]`, settings)) return "me";
  const target = normName(owner);
  if (!target.length) return "unknown";
  const company = normName([client.name, client.profile?.emailName ?? "", client.domain.split(".")[0]].join(" "));
  if (target.every((w) => company.includes(w))) return "client";
  const hit = people.find((p) => matchesPerson(target, p.name, p.email));
  if (hit) return hit.role === "team" || hit.role === "owner" ? "team" : "client";
  // No asistió a ninguna reunión registrada, pero escribió en los hilos de la cuenta.
  const mail = (client.activity?.recentMails ?? []).find((m) => matchesPerson(target, m.fromName, m.from));
  if (mail?.direction === "client") return "client";
  if (mail?.direction === "me") return "me";
  return mail?.direction === "team" ? "team" : "unknown";
}

/**
 * De qué lado está un accionable "[Nombre, Nombre] …": mío (alias), equipo propio, cliente,
 * compartido ("[El grupo]" o dueños de ambos lados) o desconocido.
 */
export function stepSide(
  step: string,
  client: ClientRecord,
  ownerEmail: string | null,
  settings: WorkSettings,
): StepSide {
  const { owners } = parseStep(step, new Date().toISOString());
  const people = computeParticipants(client, ownerEmail);
  const sides = owners.map((o) => ownerSide(o, client, people, settings)).filter((s) => s !== "unknown");
  if (!sides.length) return "unknown";
  const ours = sides.some((s) => s === "me" || s === "team");
  if (sides.includes("shared") || (ours && sides.includes("client"))) return "shared";
  if (!ours) return "client";
  return sides.includes("me") ? "me" : "team";
}

/** Lado corregido a mano en /accionables: debo → mío; me deben → de su lado (si lo detectado era nuestro). */
function overrideSide(client: ClientRecord, id: string, side: StepSide): StepSide {
  const o = client.actionableSide?.[id];
  if (o === "debo") return "me";
  if (o === "me_deben" && (side === "me" || side === "team")) return "client";
  return side;
}

/** Fecha objetivo para mostrar en el mail; las ya vencidas no se exponen al cliente. */
const dueSuffix = (due: StepDue | null, now: Date) => (due && due.until >= now ? ` – objetivo: ${due.label}` : "");

// Buzones de un área: su nombre visible suele ser el área o la empresa, no una persona.
const GENERIC_MAILBOX =
  /^(info|informes|contacto|contact|cuentas|adm|admin|administracion|operaciones|ventas|compras|facturacion|facturas|proveedores|pagos|tesoreria|soporte|sistemas|recepcion|reservas|hola|consultas|gerencia|rrhh)([._-]|\d|@)/i;

const companyName = (client: ClientRecord) => client.profile?.emailName || client.name;

/** "gonzalo.alvarez@x.com" → "Gonzalo". Sin separador no se adivina: "gperez" no dice dónde termina el nombre. */
function nameFromEmail(email: string): string | null {
  const [first, ...rest] = email.split("@")[0].split(/[._-]+/);
  return rest.length && first.length >= 3 ? first[0].toUpperCase() + first.slice(1) : null;
}

/** El nombre del perfil se usa tal cual; si no, el primer nombre detectado, salvo buzones genéricos. */
function greet(recipients: { email: string; name: string | null }[], client: ClientRecord): string {
  const custom = client.profile?.contactNames ?? {};
  const names = recipients.map((r) => {
    const email = r.email.toLowerCase();
    if (custom[email]) return custom[email];
    if (GENERIC_MAILBOX.test(email)) return null;
    // Calendar a veces trae el mail como nombre.
    return r.name && !r.name.includes("@") ? r.name.split(/\s+/)[0] : nameFromEmail(email);
  });
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length) {
    return `Hola ${unique.length > 1 ? `${unique.slice(0, -1).join(", ")} y ${unique.at(-1)}` : unique[0]},`;
  }
  return client.profile?.emailName ? `Hola equipo de ${client.profile.emailName},` : "Hola equipo,";
}

/** Follow-up: hitos y decisiones de la reunión + accionables vigentes, al día con mails y accionables tildados. */
export function buildFollowup(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): FollowupDraft {
  const now = new Date();
  const recipients = followupRecipients(client, meeting, ownerEmail);
  // Arrastrados cerrados antes de esta reunión ya no son novedad.
  const actionables = accountActionables(client).filter(
    (a) => !a.done || !a.carried || (a.doneAt && a.doneAt >= meeting.date),
  );
  const trace = mailTrace(client, meeting);
  const interaction = latestInteraction(client, meeting);
  // Hilo: fijado → asunto estándar → último con el cliente → nuevo. Lo que el cliente mandó por separado
  // después de la reunión se retoma acá (línea + Cc) para no partir el seguimiento.
  const thread = pickFollowupThread(client);
  const strays = strayClientMails(client, thread.threadId, meeting.date);
  // `owner` = responsables según la minuta (" (Gonzalo)"); vacío si no se dijo.
  const steps: { text: string; owner: string; side: StepSide; done: boolean; doneAt: string | null }[] = actionables.map((a) => ({
    text:
      `${formatStep(a.step)}${a.done ? "" : dueSuffix(agreedDue(client, a.id, a.step, a.meeting.date, settings.workDays), now)}` +
      (!a.done && trace.has(a.id) ? ` (conversado por mail el ${fmtShort(trace.get(a.id)!.date)})` : "") +
      (!a.done && a.carried ? ` [acordado el ${fmtShort(a.meeting.date)}]` : ""),
    owner: groupTag(a.step),
    side: overrideSide(client, a.id, stepSide(a.step, client, ownerEmail, settings)),
    done: a.done,
    doneAt: a.doneAt,
  }));
  const requests = openRequests(client, interaction).map((r) => ({
    text: `${r.title} (consulta por mail)`,
    owner: "",
    side: "team" as StepSide,
    done: false,
    doneAt: null,
  }));
  const open = [...steps.filter((s) => !s.done), ...requests];
  // Lado Xtract: todo a mi nombre. Lado cliente (incluye compartidos y sin lado claro): el responsable de la
  // minuta o "Equipo" (todos los participantes) si no se dijo.
  const me = firstName(settings.ownerAliases[0] ?? "Alexis");
  const ours = open.filter((s) => s.side === "me" || s.side === "team");
  const theirs = open.filter((s) => !(s.side === "me" || s.side === "team"));
  const agreed = (meeting.decisions ?? []).filter((d) => d.agreed).map((d) => `• ${d.text}`);
  const pending = (meeting.decisions ?? []).filter((d) => !d.agreed).map((d) => `• Por definir: ${d.text}`);
  const milestones = (meeting.milestones ?? []).map((m) => `• ${milestoneTitle(m)}`);
  const talked = [...(meeting.summary ? [meeting.summary] : []), ...agreed, ...pending];

  // Un solo referente: se le habla a él; dos o más: en plural.
  const one = recipients.length === 1;
  const when = meetingWhen(meeting.date, now);
  const section = (title: string, rows: string[]) => (rows.length ? ["", title, ...rows] : []);
  const lines = [
    greet(recipients, client),
    "",
    `Gracias por el espacio ${when.text}${when.recent ? "" : ","} y por ${one ? "tu" : "su"} tiempo y disposición. ${one ? "Te" : "Les"} comparto un resumen y los próximos pasos.`,
    // Orden: puntos importantes → lo charlado → accionables del cliente → de Xtract → lo ya avanzado.
    ...section("Puntos importantes:", milestones),
    ...section("Lo que charlamos:", talked),
    ...section(
      `Accionables de ${companyName(client)}:`,
      theirs.map((s) => `• ${s.text} (${s.owner || "Equipo"})${STATUS_PENDING}`),
    ),
    ...section("Accionables de Xtract:", ours.map((s) => `• ${s.text} (${me})${STATUS_PENDING}`)),
    ...section(
      "Ya avanzamos con:",
      steps.filter((s) => s.done).map((s) => `✓ ${s.text}${s.owner ? ` (${s.owner})` : ""}${doneStatus(s.doneAt)}`),
    ),
    ...(strays.length ? ["", strayLine(strays, one)!] : []),
    // Dos líneas en blanco = un espacio más antes del cierre y antes de "Saludos" (ver `bodyToHtml`).
    "",
    "",
    `Quedo a disposición por si ${one ? "tienes" : "tienen"} alguna consulta o por si me faltó agregar algo más.`,
    "",
    "",
    "Saludos",
  ];

  const reviewNotes = [...thread.notes, ...strayNotes(strays), ...lastTalkNote(interaction)];
  if (!meeting.summary) reviewNotes.push("La minuta no trae resumen: agregalo si hace falta.");
  if (meeting.milestones === undefined) {
    reviewNotes.push("Esta minuta todavía no se reprocesó: los hitos y decisiones aparecen después de la próxima sincronización.");
  }
  if (!steps.length && !requests.length) reviewNotes.push("La minuta no trae próximos pasos: definí los accionables para la próxima sesión.");

  return {
    meetingId: meeting.id,
    subject: thread.subject ? `Re: ${cleanThreadSubject(thread.subject)}` : standardSubject(client),
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    cc: withStrayCc(newMailCc(client, ownerEmail, recipients), strayParticipants(client, strays), ownerEmail, recipients),
    updatedAt: now.toISOString(),
    threadId: thread.threadId,
    threadReason: thread.reason,
    reviewNotes,
  };
}

/**
 * Mail de seguimiento: parte de la última interacción (reunión o último mail recibido/enviado),
 * con el estado actual de los accionables (tildados = completados) y, si la interacción es un mail
 * del cliente, sus pedidos. Pensado para no dejar pasar más de N días hábiles sin novedades.
 */
export function buildStatusUpdate(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): FollowupDraft {
  const now = new Date();
  const steps = accountActionables(client).map((a) => ({
    ...a,
    text: formatStep(a.step),
    who: ownerTag(a.step),
    due: agreedDue(client, a.id, a.step, a.meeting.date, settings.workDays),
    side: overrideSide(client, a.id, stepSide(a.step, client, ownerEmail, settings)),
  }));
  // Avances = accionables tildados desde mi último mail posterior a la reunión (o desde la reunión).
  const lastMine = (client.activity?.recentMails ?? [])
    .filter((m) => m.direction === "me" && m.date > meeting.date)
    .reduce<MailRef | null>((last, m) => (!last || m.date > last.date ? m : last), null);
  const since = lastMine?.date ?? meeting.date;
  // Lo completado incluye las consultas por mail que tildé, además de los accionables de la minuta.
  const doneAt = client.doneTicketAt ?? {};
  const completed = [
    ...steps
      .filter((s) => s.done && (!s.carried || (s.doneAt && s.doneAt >= meeting.date)))
      .map((s) => ({ text: `${s.text}${s.who}`, doneAt: s.doneAt })),
    ...mailTickets(client)
      .filter((t) => t.kind === "request" && t.date > meeting.date && doneAt[t.id])
      .map((t) => ({ text: t.title, doneAt: doneAt[t.id] })),
  ];
  const advanced = completed
    .filter((c) => c.doneAt && c.doneAt >= since)
    .sort((a, b) => a.doneAt!.localeCompare(b.doneAt!));
  const completedBefore = completed.filter((c) => !advanced.includes(c));
  const interaction = latestInteraction(client, meeting);
  const anchorMail = interaction.kind === "mail" ? interaction.mail : null;
  const pending = steps.filter((s) => !s.done);
  // Trazabilidad: lo pendiente que ya se habló por mail va aparte. No se da por completado: eso lo
  // define lo tildado, porque la relación se detecta por palabras clave.
  const trace = mailTrace(client, meeting);
  const related = pending.filter((s) => trace.has(s.id));
  const open = pending.filter((s) => !trace.has(s.id));
  const tag = (s: (typeof steps)[number]) =>
    `${dueSuffix(s.due, now)}${s.carried ? ` [acordado el ${fmtShort(s.meeting.date)}]` : ""}${s.who}`;
  const ours = open.filter((s) => s.side === "me" || s.side === "team");
  const theirs = open.filter((s) => s.side === "client");
  const shared = open.filter((s) => s.side === "shared");
  const other = open.filter((s) => s.side === "unknown");
  const requests = openRequests(client, interaction);
  const recipients = interactionRecipients(client, meeting, interaction, ownerEmail);
  const meetingRef = `la reunión ${meetingWhen(meeting.date, now).text}`;
  const progress = !steps.length
    ? `Les escribo para retomar lo conversado en ${meetingRef}.`
    : pending.length
      ? `Les comparto ${completed.length ? "los avances sobre" : "cómo venimos con"} lo acordado en ${meetingRef}:`
      : `Les confirmo que quedaron completos todos los puntos acordados en ${meetingRef}.`;

  const lines = [greet(recipients, client), ""];
  if (anchorMail?.direction === "client") {
    lines.push(`Gracias por el mail del ${fmtDate(anchorMail.date)} sobre “${cleanSubject(anchorMail.subject)}”.`, "", progress);
  } else if (anchorMail) {
    lines.push(`Retomo mi mail del ${fmtDate(anchorMail.date)} sobre “${cleanSubject(anchorMail.subject)}”.`, "", progress);
  } else {
    lines.push(progress);
  }
  if (advanced.length) {
    lines.push(
      "",
      lastMine ? `Avanzamos desde mi último mail (${fmtShort(lastMine.date)}):` : "Avanzamos desde la reunión:",
      ...advanced.map((c) => `✓ ${c.text}${doneStatus(c.doneAt)}`),
    );
  }
  if (completedBefore.length) lines.push("", "Ya completado:", ...completedBefore.map((c) => `✓ ${c.text}${doneStatus(c.doneAt)}`));
  if (related.length) {
    lines.push(
      "",
      "Conversado por mail desde la reunión:",
      ...related.map((s) => `• ${s.text} (mail del ${fmtShort(trace.get(s.id)!.date)})${tag(s)}${STATUS_PENDING}`),
    );
  }
  if (ours.length) lines.push("", "En curso de nuestro lado:", ...ours.map((s) => `• ${s.text}${tag(s)}${STATUS_PENDING}`));
  if (requests.length) lines.push("", "Sobre lo que nos consultaron, lo estamos revisando:", ...requests.map((r) => `• ${r.title}${STATUS_PENDING}`));
  if (theirs.length) lines.push("", "Pendiente de su lado (para poder avanzar):", ...theirs.map((s) => `• ${s.text}${tag(s)}${STATUS_PENDING}`));
  if (shared.length) lines.push("", "Para resolver en conjunto:", ...shared.map((s) => `• ${s.text}${tag(s)}${STATUS_PENDING}`));
  if (other.length) lines.push("", "Otros pendientes acordados:", ...other.map((s) => `• ${s.text}${tag(s)}${STATUS_PENDING}`));
  lines.push("", "Cualquier duda o si hay algo para priorizar, me avisan.", "", "Saludos");

  const reviewNotes = lastTalkNote(interaction);
  if (requests.length) reviewNotes.push(`Agregá la respuesta a ${requests.length} consulta(s) del cliente.`);
  if (lastMine && anchorMail === lastMine && !advanced.length) {
    reviewNotes.push("Sin avances nuevos desde tu último mail: evaluá si hace falta enviarlo ahora.");
  }
  if (!anchorMail && steps.length && !completed.length) {
    reviewNotes.push("Todavía no marcaste accionables como completados: el mail solo lista lo pendiente.");
  }
  const overdue = pending.filter((s) => s.due && s.due.until < now && s.side !== "client");
  if (overdue.length) reviewNotes.push(`Fecha objetivo vencida, omitida del mail: ${overdue.map((s) => s.text).join(" · ")}`);
  for (const s of pending.filter((p) => p.side === "me" || p.side === "team")) {
    const note = relatedMailNote(client, s.id);
    if (note) reviewNotes.push(`${s.text} → ${note}`);
  }
  const lastMail = client.activity?.lastMail;
  if (anchorMail && lastMail?.direction === "team" && lastMail.date > anchorMail.date) {
    reviewNotes.push(`${lastMail.fromName ?? lastMail.from} escribió después (${fmtShort(lastMail.date)}, “${lastMail.subject}”): revisá que no se repita.`);
  }

  // Sin mail de partida: mismo hilo que el post-reunión (fijado → estándar → último con el cliente → nuevo).
  const thread = anchorMail ? null : pickFollowupThread(client);
  if (thread) reviewNotes.unshift(...thread.notes);
  return {
    meetingId: meeting.id,
    subject: anchorMail
      ? `Re: ${cleanSubject(anchorMail.subject)}`
      : thread?.subject
        ? `Re: ${cleanThreadSubject(thread.subject)}`
        : `Actualización de avance – ${companyName(client)}`,
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    cc: anchorMail
      ? replyAllCc(client, anchorMail.threadId, ownerEmail, recipients)
      : newMailCc(client, ownerEmail, recipients),
    updatedAt: now.toISOString(),
    threadId: anchorMail ? anchorMail.threadId : thread!.threadId,
    threadReason: anchorMail ? "anchor" : thread!.reason,
    reviewNotes,
  };
}

/**
 * Qué mail toca en la cuenta (un solo editor): mientras la minuta no salió (sin envío, sin "Enviar follow-up"
 * tildado y sin mail mío posterior a la reunión) es el post-reunión, que ya refleja lo tildado; después pasa a
 * ser el de seguimiento (avances desde la reunión o mi último mail + lo que queda).
 */
export function currentFollowupKind(client: ClientRecord, meeting: DiscoveredMeeting): FollowupKind {
  if (client.followups?.[followupKey("meeting", meeting.id)]?.sentAt) return "status";
  if (client.doneTicketIds?.includes(followupTicketId(client.id, meeting.id))) return "status";
  const wroteAfter = (client.activity?.recentMails ?? []).some((m) => m.direction === "me" && m.date > meeting.date);
  return wroteAfter ? "status" : "meeting";
}

/** `getDraft` del tipo que toca ahora (`currentFollowupKind`). */
export function getFollowupDraft(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
) {
  const kind = currentFollowupKind(client, meeting);
  return { kind, ...getDraft(kind, client, meeting, ownerEmail, settings) };
}

/**
 * Borrador vigente según el tipo. Un envío previo cierra ese mensaje (se genera uno nuevo). Una edición
 * guardada se conserva hasta que cambien los accionables o llegue un mail; ahí se regenera con el
 * estado actual, manteniendo los destinatarios editados.
 */
export function getDraft(
  kind: FollowupKind,
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): { draft: FollowupDraft; generated: FollowupDraft; regenerated: boolean; lastSentAt: string | null } {
  const generated =
    kind === "status"
      ? buildStatusUpdate(client, meeting, ownerEmail, settings)
      : buildFollowup(client, meeting, ownerEmail, settings);
  const saved = client.followups?.[followupKey(kind, meeting.id)];
  const lastSentAt = saved?.sentAt ?? null;
  if (!saved || saved.sentAt) return { draft: generated, generated, regenerated: false, lastSentAt };
  const changedAt = [client.ticketsUpdatedAt, client.profileUpdatedAt, client.activity?.lastMail?.date].filter(Boolean).sort().at(-1);
  if (changedAt && changedAt > saved.updatedAt) {
    return {
      draft: {
        ...generated,
        to: saved.to.length ? saved.to : generated.to,
        cc: saved.cc?.length ? saved.cc : generated.cc,
        // Sigue siendo el mismo mail: "Borrador en Gmail" actualiza ese borrador y el panel avisa que quedó viejo.
        gmailDraftId: saved.gmailDraftId,
        gmailMessageId: saved.gmailMessageId,
        draftCreatedAt: saved.draftCreatedAt,
        gmailBody: saved.gmailBody,
        threadId: generated.threadId ?? saved.threadId,
      },
      generated,
      regenerated: true,
      lastSentAt,
    };
  }
  return { draft: saved, generated, regenerated: false, lastSentAt };
}

/**
 * Mail de los lunes: los pendientes de la cuenta como objetivos de la semana (lo que debo y lo que me deben)
 * y lo que se completó en los últimos 7 días. Las fechas solo si se acordaron (nunca la meta interna).
 * `null` si no queda nada pendiente con la cuenta.
 */
export function buildWeeklyPlan(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
  now = new Date(),
): FollowupDraft | null {
  const base = buildStatusUpdate(client, meeting, ownerEmail, settings);
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const all = accountActionables(client);
  const line = (a: (typeof all)[number]) => {
    const due = agreedDue(client, a.id, a.step, a.meeting.date, settings.workDays);
    const dueTxt = due && due.until >= now ? ` – para ${due.label.startsWith("semana") ? "la" : "el"} ${due.label}` : "";
    return `${formatStep(a.step)}${dueTxt}${ownerTag(a.step)}`;
  };
  const sideOf = (a: (typeof all)[number]) => overrideSide(client, a.id, stepSide(a.step, client, ownerEmail, settings));
  const open = all.filter((a) => !a.done);
  const ours = open.filter((a) => ["me", "team"].includes(sideOf(a)));
  const theirs = open.filter((a) => sideOf(a) === "client");
  const shared = open.filter((a) => sideOf(a) === "shared");
  const other = open.filter((a) => sideOf(a) === "unknown");
  const done = new Set(client.doneTicketIds ?? []);
  const mail = mailTickets(client).filter((t) => (t.kind === "request" || t.kind === "commitment") && !done.has(t.id));
  const finished = all.filter((a) => a.done && a.doneAt && Date.parse(a.doneAt) >= weekAgo);
  if (!open.length && !mail.length) return null;

  const pend = (text: string) => `• ${text}${STATUS_PENDING}`;
  const section = (title: string, rows: string[]) => (rows.length ? ["", title, ...rows] : []);
  const recipients = base.to.map((email) => ({ email, name: null as string | null }));
  const lines = [
    greet(recipients, client),
    "",
    "Les comparto los objetivos de esta semana para seguir avanzando con la integración.",
    ...section(
      "Lo que completamos la semana pasada:",
      finished.map((a) => `✓ ${formatStep(a.step)}${ownerTag(a.step)}${doneStatus(a.doneAt)}`),
    ),
    ...section("Objetivos de nuestro lado:", [
      ...ours.map((a) => pend(line(a))),
      ...mail.map((t) => pend(`${t.title} (${t.kind === "request" ? "consulta por mail" : "lo que quedé en enviar"})`)),
    ]),
    ...section("Objetivos de su lado (para poder avanzar):", theirs.map((a) => pend(line(a)))),
    ...section("Para resolver en conjunto:", shared.map((a) => pend(line(a)))),
    ...section("Otros pendientes acordados:", other.map((a) => pend(line(a)))),
    "",
    "La idea es cerrar estos puntos en el transcurso de la semana. Cualquier duda o si hay algo para priorizar, me avisan.",
    "",
    "Saludos",
  ];
  return {
    ...base,
    subject: base.threadId ? base.subject : `Objetivos de la semana – ${companyName(client)}`,
    body: lines.join("\n"),
    reviewNotes: [],
  };
}
