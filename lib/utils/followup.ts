import {
  followupKey,
  followupTicketId,
  meetingEnd,
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
import { parseStep } from "@/lib/utils/gemini-notes-parser";
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
import { actionableLine, greetingName, renderPostMeetingMail, statusSuffix, weeklyClosing, weeklyThanks, type MailStatus } from "@/lib/utils/postmeeting-mail";
import type { Actionable } from "@/lib/utils/actionables";
import type { AISide } from "@/lib/llm/postmeeting-schema";
import { statusKey, type StatusMailInput } from "@/lib/llm/status-mail";
import { clientMailKey, type ClientMailInput, type ClientMailMode } from "@/lib/llm/reply-mail";
import { weeklyKey, type WeeklyMailInput, type WeeklyMailOutput } from "@/lib/llm/weekly-mail";

// Borradores recalculados con cada mail, reunión o accionable tildado. El de la minuta (`buildFollowup`) usa el
// contenido generado por Claude cuando la reunión lo tiene (`meeting.ai`) y, si no, el armado por reglas; en ambos
// casos con el mismo template (`renderPostMeetingMail`).
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
// "Status:" en negrita y el valor en negrita con color.
export const STATUS_PENDING = statusSuffix("Pendiente");
/** " - Status: Hecho ✅ (02/11)" */
const doneStatus = (doneAt: string | null) => statusSuffix("Hecho", doneAt ? fmtDay(doneAt) : null);

/** Metadatos de la IA para un accionable de minuta (status y empresa), si su reunión se generó con IA. */
function aiStep(clientId: string, a: Actionable) {
  const prefix = `${clientId}:${a.meeting.id}-`;
  if (!a.meeting.ai || !a.id.startsWith(prefix)) return null;
  return a.meeting.ai.steps[Number(a.id.slice(prefix.length))] ?? null;
}

const AI_SIDE: Record<AISide, StepSide> = { cliente: "client", xtract: "me", ambas: "shared" };

/**
 * Cuándo fue la reunión, relativo a hoy, para el agradecimiento: "de hoy", "de ayer", "del miércoles" (esta semana),
 * "del miércoles de la semana pasada" o, si es más vieja, "del día 30/10".
 */
export function meetingDay(iso: string, now: Date): string {
  const d = new Date(iso);
  const dayNum = (x: Date) => Math.round(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000);
  const days = dayNum(now) - dayNum(d);
  if (days <= 0) return "de hoy";
  if (days === 1) return "de ayer";
  // Semanas de lunes a domingo: 0 = esta semana, 1 = la pasada.
  const weekStart = (x: Date) => dayNum(x) - ((x.getDay() + 6) % 7);
  const weeksAgo = Math.round((weekStart(now) - weekStart(d)) / 7);
  const weekday = d.toLocaleDateString("es", { weekday: "long" });
  if (weeksAgo === 0) return `del ${weekday}`;
  if (weeksAgo === 1) return `del ${weekday} de la semana pasada`;
  return `del día ${fmtDay(iso)}`;
}

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
  settings: WorkSettings,
): { email: string; name: string | null }[] {
  const fallback = followupRecipients(client, meeting, ownerEmail, settings);
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

/** Hablante de la transcripción ↔ persona: "Yani Origüela" ↔ yanina.origuela@ (mismo apellido e inicial). */
function speakerIs(speaker: string, p: { name: string | null; email: string }): boolean {
  const target = normName(speaker);
  if (!target.length || matchesPerson(target, p.name, p.email)) return true;
  const local = normName(p.email.split("@")[0].replace(/[._-]/g, " "));
  const last = target.at(-1)!;
  return target.length >= 2 && last.length >= 4 && local.length >= 2 && local.includes(last) && local[0][0] === target[0][0];
}

/**
 * Del lado del cliente, quiénes participaron de la reunión: los que hablaron en la transcripción (Xtract, equipo y
 * partners no cuentan). Si habló alguien que no se puede identificar (una sala, un usuario genérico, un nombre
 * cortado) o no hay transcripción: los invitados del cliente. Fallback: todos los referentes de la cuenta.
 */
export function followupRecipients(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): { email: string; name: string | null }[] {
  const people = computeParticipants(client, ownerEmail);
  const referents = people.filter((p) => p.role === "referent");
  const attended = new Set((meeting.attendees ?? []).map((a) => a.email.toLowerCase()));
  const invited = referents.filter((p) => attended.has(p.email));
  // Gemini a veces lista como hablante la pantalla compartida o un fragmento del título (1 turno).
  const speakers = (meeting.speakers ?? []).filter((s) => s.turns >= 2 && !/\b(presentation|presentaci[oó]n)\b/i.test(s.name));
  let chosen = invited.length ? invited : referents;
  if (speakers.length) {
    const spoke: typeof referents = [];
    let unknown = false;
    for (const s of speakers) {
      // Yo primero por alias: un rol aprendido equivocado no puede mandarme del lado del cliente.
      const spoken = normName(s.name).join(" ");
      if (settings.ownerAliases.some((a) => normName(a).join(" ") === spoken)) continue;
      const side = ownerSide(s.name, client, people, settings);
      if (side === "me" || side === "team") continue;
      const hit = invited.find((p) => speakerIs(s.name, p)) ?? referents.find((p) => speakerIs(s.name, p));
      if (hit) spoke.push(hit);
      else unknown = true;
    }
    if (spoke.length && !unknown) chosen = [...new Set(spoke)];
  }
  const mailNames = senderNames(client);
  return chosen.map((p) => ({
    email: p.email,
    name: p.name ?? mailNames.get(p.email) ?? null,
  }));
}

/** "Buenos días" hasta las 11:55; después, "Buenas tardes" (hora en que se genera el mail). */
export function salutation(now: Date): string {
  return now.getHours() * 60 + now.getMinutes() < 11 * 60 + 55 ? "Buenos días" : "Buenas tardes";
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
  const recipients = followupRecipients(client, meeting, ownerEmail, settings);
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
  const company = companyName(client);
  const both = `Xtract y ${company}`;
  // `owner` = responsables según la minuta (" (Gonzalo)"); vacío si no se dijo. Con IA, status (Pendiente / En curso /
  // Stand By) y empresa del responsable salen de la generación; el lado puesto a mano sigue mandando.
  const steps: { text: string; owner: string; side: StepSide; status: MailStatus; done: boolean; doneAt: string | null }[] =
    actionables.map((a) => {
      const ai = aiStep(client.id, a);
      const side = overrideSide(client, a.id, ai ? AI_SIDE[ai.empresa] : stepSide(a.step, client, ownerEmail, settings));
      // Con IA el mail lleva la versión corta (la card, el detalle); si lo editaste a mano, tu texto.
      const base = ai?.mail && !client.actionableEdits?.[a.id] ? ai.mail : formatStep(a.step);
      return {
        text:
          base.replace(/\s*\.+$/, "") +
          (!a.done && trace.has(a.id) ? ` (conversado por mail el ${fmtShort(trace.get(a.id)!.date)})` : "") +
          (!a.done && a.carried ? ` [acordado el ${fmtShort(a.meeting.date)}]` : ""),
        owner: ai?.empresa === "ambas" ? both : groupTag(a.step),
        side,
        status: ai && ai.status !== "Hecho" ? ai.status : "Pendiente",
        done: a.done,
        doneAt: a.doneAt,
      };
    });
  const requests = openRequests(client, interaction).map((r) => ({
    text: `${r.title} (consulta por mail)`,
    owner: "",
    side: "team" as StepSide,
    status: "Pendiente" as MailStatus,
    done: false,
    doneAt: null,
  }));
  const open = [...steps.filter((s) => !s.done), ...requests];
  // Lado Xtract: todo a mi nombre (salvo lo de ambas partes). Lado cliente (incluye compartidos y sin lado claro):
  // el responsable de la minuta o "Equipo" (todos los participantes) si no se dijo.
  const me = firstName(settings.ownerAliases[0] ?? "Alexis");
  const isOurs = (s: (typeof open)[number]) => s.side === "me" || s.side === "team";
  const ours = open.filter(isOurs);
  const theirs = open.filter((s) => !isOurs(s));

  // Contenido de la reunión: el de la IA si existe; si no, el de la minuta de Gemini por reglas.
  const ai = meeting.ai;
  const puntos = ai ? ai.puntos : (meeting.milestones ?? []).map(milestoneTitle);
  // Con IA, los bullets de "Lo que charlamos" ya cubren el objetivo (como en el ejemplo del prompt).
  const objetivo = ai ? null : meeting.summary;
  const charlamos = ai
    ? ai.charlamos
    : [
        ...(meeting.decisions ?? []).filter((d) => d.agreed).map((d) => d.text),
        ...(meeting.decisions ?? []).filter((d) => !d.agreed).map((d) => `Por definir: ${d.text}`),
      ];

  // Un solo referente: se le habla a él; dos o más: en plural.
  const one = recipients.length === 1;
  // Sin nombre conocido para ese único destinatario ("dacosta@…"), el que la IA reconoció en la reunión.
  // Sin ningún nombre, saludo sin "equipo" (el resto del mail le habla a una persona).
  const oneGreeting = () => {
    const hello = greet(recipients, client);
    if (!hello.startsWith("Hola equipo")) return hello.replace(/^Hola\b/, salutation(now));
    const aiName = greetingName(ai?.intro ?? "");
    return aiName ? `${salutation(now)} ${aiName},` : `${salutation(now)},`;
  };
  const body = renderPostMeetingMail({
    greeting: one ? oneGreeting() : `${salutation(now)} equipo,`,
    // Apertura de la semana (la misma para todas las cuentas, cambia cada lunes), con el día relativo a la reunión.
    thanks: weeklyThanks(now, meetingDay(meeting.date, now), one),
    puntos,
    objetivo,
    charlamos,
    clientName: company,
    theirs: theirs.map((s) => actionableLine(s.text, s.owner || "Equipo", s.status)),
    ours: ours.map((s) => actionableLine(s.text, s.owner === both ? both : me, s.status)),
    done: steps.filter((s) => s.done).map((s) => actionableLine(s.text, s.owner || me, "Hecho", s.doneAt ? fmtDay(s.doneAt) : null)),
    extra: strays.length ? [strayLine(strays, one)!] : [],
    // Cierre de la semana, igual que la apertura.
    closing: weeklyClosing(now, one),
  });

  const reviewNotes = [...thread.notes, ...strayNotes(strays), ...lastTalkNote(interaction)];
  if (ai) {
    reviewNotes.push(...ai.revision);
    const unclear = ai.steps.filter((s) => s.requiereRevision).length;
    if (unclear) reviewNotes.push(`${unclear} accionable(s) sin responsable claro en la reunión: revisalos antes de enviar.`);
  } else {
    if (meeting.aiError) reviewNotes.push(`No se pudo generar el resumen con IA (${meeting.aiError}): se armó por reglas.`);
    if (!meeting.summary) reviewNotes.push("La minuta no trae resumen: agregalo si hace falta.");
    if (meeting.milestones === undefined) {
      reviewNotes.push("Esta minuta todavía no se reprocesó: los hitos y decisiones aparecen después de la próxima sincronización.");
    }
  }
  if (!steps.length && !requests.length) reviewNotes.push("La minuta no trae próximos pasos: definí los accionables para la próxima sesión.");

  return {
    meetingId: meeting.id,
    subject: thread.subject ? `Re: ${cleanThreadSubject(thread.subject)}` : standardSubject(client),
    body,
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
  /** Si se pasa, recibe la entrada de la IA (`statusAIRequest`). */
  capture?: { input?: StatusMailInput },
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
    // La fecha objetivo queda en la card del accionable; en el mail no va.
    `${s.carried ? ` [acordado el ${fmtShort(s.meeting.date)}]` : ""}${s.who}`;
  const ours = open.filter((s) => s.side === "me" || s.side === "team");
  const theirs = open.filter((s) => s.side === "client");
  const shared = open.filter((s) => s.side === "shared");
  const other = open.filter((s) => s.side === "unknown");
  const requests = openRequests(client, interaction);
  const recipients = interactionRecipients(client, meeting, interaction, ownerEmail, settings);
  const meetingRef = `la reunión ${meetingWhen(meeting.date, now).text}`;
  // Sin citar mails ni asuntos: seguimiento amigable de lo que veníamos hablando.
  const one = recipients.length === 1;
  const progress = !steps.length
    ? `${one ? "Te" : "Les"} escribo para retomar lo que veníamos conversando.`
    : pending.length
      ? `${one ? "Te" : "Les"} comparto ${completed.length ? "los avances" : "cómo venimos"} con lo que veníamos conversando.`
      : `${one ? "Te" : "Les"} confirmo que quedaron completos todos los puntos que veníamos trabajando.`;
  void meetingRef;

  // Secciones del mail con refs: las reglas deciden qué va y con qué estado; la IA (si hay) solo redacta.
  type Line = { ref: string; text: string; suffix: string; bullet: "✓" | "•" };
  const section = (title: string, prefix: string, items: Omit<Line, "ref">[]) => ({
    title,
    lines: items.map((it, i) => ({ ...it, ref: `${prefix}${i + 1}` })),
  });
  const sections = [
    section(
      "Lo que avanzamos:",
      "H",
      advanced.map((c) => ({ text: c.text, suffix: doneStatus(c.doneAt), bullet: "✓" })),
    ),
    section("Ya completado:", "C", completedBefore.map((c) => ({ text: c.text, suffix: doneStatus(c.doneAt), bullet: "✓" }))),
    section(
      "En curso, ya lo veníamos hablando:",
      "M",
      related.map((s) => ({ text: s.text, suffix: `${tag(s)}${STATUS_PENDING}`, bullet: "•" })),
    ),
    section("En lo que estamos trabajando:", "N", ours.map((s) => ({ text: s.text, suffix: `${tag(s)}${STATUS_PENDING}`, bullet: "•" }))),
    section(
      "Sobre sus consultas, lo estamos revisando:",
      "Q",
      requests.map((r) => ({ text: r.title, suffix: STATUS_PENDING, bullet: "•" })),
    ),
    section("Lo que necesitamos de su lado para avanzar:", "S", theirs.map((s) => ({ text: s.text, suffix: `${tag(s)}${STATUS_PENDING}`, bullet: "•" }))),
    section("Para resolver en conjunto:", "J", shared.map((s) => ({ text: s.text, suffix: `${tag(s)}${STATUS_PENDING}`, bullet: "•" }))),
    section("Otros pendientes:", "O", other.map((s) => ({ text: s.text, suffix: `${tag(s)}${STATUS_PENDING}`, bullet: "•" }))),
  ].filter((sec) => sec.lines.length);
  const lastInteraction = anchorMail
    ? `${anchorMail.direction === "me" ? "Mi mail" : `Mail de ${anchorMail.fromName ?? anchorMail.from}`} del ${fmtDate(anchorMail.date)} «${cleanSubject(anchorMail.subject)}»: ${anchorMail.excerpt.replace(/\s+/g, " ").trim().slice(0, 1200)}`
    : null;
  const aiInput: StatusMailInput = {
    clientName: companyName(client),
    ownerName: settings.ownerAliases[0] ?? "Alexis Vásquez R",
    today: fmtDate(now.toISOString()),
    recipients: recipients.map((r) => r.name ?? r.email),
    lastInteraction,
    meeting: { title: meeting.title, date: fmtDate(meeting.date), objetivo: meeting.ai?.objetivo ?? meeting.summary ?? null },
    sections: sections.map((sec) => ({ title: sec.title, items: sec.lines.map((l) => ({ ref: l.ref, text: l.text })) })),
    guidance: client.analysis?.output.proximo_mail ?? null,
    attention: Boolean(client.profile?.attention),
  };
  if (capture) capture.input = aiInput;
  const aiKey = statusKey(aiInput);
  const ai = client.statusAI?.meetingId === meeting.id && client.statusAI.key === aiKey ? client.statusAI : null;
  const aiText = new Map(Object.entries(ai?.items ?? {}));

  const lines = [greet(recipients, client), ""];
  lines.push(ai?.apertura ?? progress);
  for (const sec of sections) {
    lines.push("", sec.title, ...sec.lines.map((l) => `${l.bullet} ${(aiText.get(l.ref) ?? l.text).replace(/[.\s]+$/, "")}${l.suffix}`));
  }
  lines.push("", ai?.cierre ?? `Cualquier duda o si hay algo para priorizar, ${one ? "avisame" : "me avisan"}.`, "", "Saludos");

  const reviewNotes = lastTalkNote(interaction);
  if (ai) reviewNotes.unshift(`Redactado con IA (${fmtShort(ai.generatedAt)}): revisalo antes de enviar.`, ...ai.revision);
  const analysis = client.analysis;
  if (analysis) {
    reviewNotes.push(`Análisis IA (${fmtShort(analysis.generatedAt)}) · próximo mail: ${analysis.output.proximo_mail}`);
    for (const r of analysis.output.posibles_resueltos) {
      const id = analysis.refs[r.ref];
      const step = steps.find((x) => x.id === id && !x.done);
      if (step) reviewNotes.push(`Posible resuelto (tildalo si es así): ${step.text} — ${r.evidencia}`);
    }
  }
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

/** Lado como en el tablero (`plannedItems`): lo manual manda; si no, `isOwnActionable` → debo, resto → me deben. */
function boardSide(client: ClientRecord, a: Actionable, settings: WorkSettings): "debo" | "me_deben" {
  return client.actionableSide?.[a.id] ?? (isOwnActionable(a.step, settings) ? "debo" : "me_deben");
}

/**
 * Puntos de Seguimiento (me deben) del lado del cliente, abiertos: los que entran en el recordatorio de la cuenta.
 * Lo que debe alguien del equipo Xtract queda afuera (no se le pide al cliente).
 */
export function reminderSteps(client: ClientRecord, ownerEmail: string | null, settings: WorkSettings): Actionable[] {
  return accountActionables(client).filter(
    (a) =>
      !a.done &&
      boardSide(client, a, settings) === "me_deben" &&
      overrideSide(client, a.id, stepSide(a.step, client, ownerEmail, settings)) !== "team",
  );
}

/** Texto corto del punto para el recordatorio: la versión de mail de la IA, o el título antes de ":" si es largo. */
function reminderText(client: ClientRecord, a: Actionable): string {
  const ai = aiStep(client.id, a);
  const text = ai?.mail && !client.actionableEdits?.[a.id] ? ai.mail : formatStep(a.step);
  const i = text.indexOf(":");
  const short = text.length > 110 && i >= 3 && i <= 70 ? text.slice(0, i) : text;
  return short.replace(/[.\s]+$/, "");
}

/**
 * Recordatorio corto y amigable pidiendo status de lo que me deben (pestaña "Recordatorio" en la cuenta y el
 * panel del Dashboard), o de un solo punto (`ticketId`, botón "Pedir status" en la card del accionable). Mismo hilo y
 * destinatarios que el de seguimiento; sin avances ni pendientes propios. Si es de un punto y su responsable
 * aparece entre los participantes del cliente, va dirigido a esa persona.
 */
export function buildReminder(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
  ticketId?: string | null,
): FollowupDraft {
  const now = new Date();
  const all = accountActionables(client).filter((a) => !a.done);
  const single = ticketId ? all.find((a) => a.id === ticketId) ?? null : null;
  const items = single ? [single] : reminderSteps(client, ownerEmail, settings);
  const interaction = latestInteraction(client, meeting);
  const anchorMail = interaction.kind === "mail" ? interaction.mail : null;
  let recipients = interactionRecipients(client, meeting, interaction, ownerEmail, settings);
  const reviewNotes: string[] = [];

  // Un solo punto: si el responsable es un participante del cliente, el mail va a esa persona (el resto en Cc).
  let ownerTo: { email: string; name: string | null }[] = [];
  if (single) {
    const owners = parseStep(single.step, single.meeting.date).owners.map(normName).filter((w) => w.length);
    const people = computeParticipants(client, ownerEmail).filter((p) => p.role === "referent" || p.role === "external");
    ownerTo = people
      .filter((p) => owners.some((o) => matchesPerson(o, p.customName ?? p.name, p.email)))
      .map((p) => ({ email: p.email, name: p.customName ?? p.name }));
    if (ownerTo.length) recipients = ownerTo;
    const side = overrideSide(client, single.id, stepSide(single.step, client, ownerEmail, settings));
    if (side === "team") reviewNotes.push("Este punto lo tiene alguien del equipo Xtract: revisá los destinatarios.");
    if (boardSide(client, single, settings) === "debo") reviewNotes.push("Este punto figura como Accionar (lo tenés vos).");
  } else if (ticketId) {
    reviewNotes.push("El punto ya no está abierto: el recordatorio lista todo lo que queda de su lado.");
  }

  const one = recipients.length === 1;
  const lines = [greet(recipients, client), ""];
  const bullets = items.map((a) => {
    const due = agreedDue(client, a.id, a.step, a.meeting.date, settings.workDays);
    const when = due ? ` (${due.until < now ? "lo teníamos para" : "quedamos para"} el ${fmtShort(due.until.toISOString())})` : "";
    return `• ${reminderText(client, a)}${single ? "" : ownerTag(a.step)}${when}`;
  });
  // De toda la cuenta: redactado con IA en tu tono si está vigente (`client.reminderAI`); si no, el texto fijo.
  const reminderAI = !single ? client.reminderAI : undefined;
  const aiBody = reminderAI && reminderAI.key === clientMailRequest("reminder", client, meeting, ownerEmail, settings).key ? reminderAI : null;
  if (aiBody) {
    lines.push(...aiBody.cuerpo.trim().split("\n"));
    reviewNotes.push(`Redactado con IA (${aiBody.model}) en tu tono: revisalo antes de enviar.`, ...resolvedNotes(aiBody), ...aiBody.revision);
  } else if (!items.length) {
    lines.push(
      `¿Cómo ${one ? "estás" : "están"}? ${one ? "Te" : "Les"} escribo para saber cómo vienen con lo que quedó de su lado.`,
      "",
      `Cuando ${one ? "puedas, me comentas" : "puedan, me comentan"} el status. ¡Gracias!`,
    );
    reviewNotes.push("No hay puntos abiertos de su lado: revisá el texto antes de enviarlo.");
  } else if (single) {
    lines.push(
      `¿Cómo ${one ? "estás" : "están"}? ${one ? "Te" : "Les"} escribo para consultar${one ? "te" : "les"} cómo viene este punto:`,
      "",
      bullets[0],
      "",
      `¿${one ? "Me podrías" : "Me podrían"} comentar el status cuando ${one ? "puedas" : "puedan"}? Si ${one ? "necesitas" : "necesitan"} algo de nuestro lado para avanzar, ${one ? "avísame" : "me avisan"}.`,
    );
  } else {
    lines.push(
      `¿Cómo ${one ? "estás" : "están"}? ${one ? "Te" : "Les"} escribo para hacer un breve seguimiento de ${items.length === 1 ? "un punto que quedó" : "algunos puntos que quedaron"} de su lado:`,
      "",
      ...bullets,
      "",
      `¿${one ? "Me podrías" : "Me podrían"} contar cómo ${items.length === 1 ? "viene" : "vienen"}? Si ${one ? "necesitas" : "necesitan"} algo de nuestra parte para avanzar, ${one ? "avísame" : "me avisan"}.`,
    );
  }
  lines.push("", "Saludos");

  if (currentFollowupKind(client, meeting) === "meeting") {
    reviewNotes.push("La minuta todavía no salió: al enviar este recordatorio, el mail de seguimiento pasa a ser el de avances.");
  }
  const thread = anchorMail ? null : pickFollowupThread(client);
  if (thread) reviewNotes.unshift(...thread.notes);
  const cc = anchorMail
    ? replyAllCc(client, anchorMail.threadId, ownerEmail, recipients)
    : newMailCc(client, ownerEmail, recipients);
  return {
    meetingId: meeting.id,
    ...(single && { ticketId: single.id }),
    subject: anchorMail
      ? `Re: ${cleanSubject(anchorMail.subject)}`
      : thread?.subject
        ? `Re: ${cleanThreadSubject(thread.subject)}`
        : `Seguimiento de pendientes – ${companyName(client)}`,
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    cc,
    updatedAt: now.toISOString(),
    threadId: anchorMail ? anchorMail.threadId : thread!.threadId,
    threadReason: anchorMail ? "anchor" : thread!.reason,
    reviewNotes,
    ...(aiBody && { ai: true }),
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
  const end = meetingEnd(meeting);
  const wroteAfter = (client.activity?.recentMails ?? []).some((m) => m.direction === "me" && m.date > end);
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

/** Recordatorio pidiendo status (`buildReminder`) + cuántos puntos de la cuenta están en Seguimiento del lado del cliente. */
export function getReminderDraft(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
  ticketId?: string | null,
) {
  return {
    kind: "reminder" as const,
    count: ticketId ? 1 : reminderSteps(client, ownerEmail, settings).length,
    ...getDraft("reminder", client, meeting, ownerEmail, settings, ticketId),
  };
}

/** Lo que el cliente espera que le respondamos: "Responder" abierto + pedidos por mail sin resolver, y sus mails. */
export function pendingReplies(client: ClientRecord) {
  const done = new Set(client.doneTicketIds ?? []);
  const tickets = mailTickets(client).filter((t) => (t.kind === "reply" || t.kind === "request") && !done.has(t.id));
  const requests = tickets.filter((t) => t.kind === "request");
  const reply = tickets.find((t) => t.kind === "reply");
  // "Responder" solo cuenta si su mail pide o pregunta algo (un envío de adjuntos no).
  const inbound = client.activity?.lastInboundMail;
  const replyAsks = !!reply && !!inbound && requests.some((r) => r.messageId === inbound.messageId);
  const ids = new Set([...requests.map((r) => r.messageId), ...(replyAsks ? [reply.messageId] : [])]);
  const recent = [...(client.activity?.recentMails ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  // Todo lo que el cliente escribió en cada hilo después de nuestro último mail ahí (tenga o no pedidos detectados):
  // una confirmación o un envío también se responde. Más los mails con pedidos todavía abiertos.
  const ourLast = new Map<string, string>();
  for (const m of recent) if (m.direction === "me" || m.direction === "team") ourLast.set(m.threadId, m.date);
  const since = Date.now() - 21 * 86_400_000;
  const mails = recent
    .filter(
      (m) =>
        ids.has(m.messageId) ||
        (m.direction === "client" && m.date > (ourLast.get(m.threadId) ?? "") && Date.parse(m.date) >= since && ids.size > 0),
    )
    .slice(-6);
  return {
    requests,
    ticketIds: [...requests.map((r) => r.id), ...(replyAsks ? [reply.id] : [])],
    mails,
  };
}

/** Aviso de lo que se tildó solo porque el cliente lo confirmó por mail (se puede destildar en la cuenta). */
function resolvedNotes(ai: { resolved?: { text: string; motivo: string }[] }): string[] {
  return (ai.resolved ?? []).map((r) => `Tildado solo (lo confirmó el cliente): ${r.text.split(":")[0]} — ${r.motivo}. Si no corresponde, destildalo en la cuenta.`);
}

/** Texto del punto para la IA: la versión de mail de la IA de la minuta o el paso, recortado. */
function stepText(client: ClientRecord, a: Actionable): string {
  const ai = aiStep(client.id, a);
  return (ai?.mail && !client.actionableEdits?.[a.id] ? ai.mail : formatStep(a.step)).slice(0, 300);
}

/** Extractos de mis mails a la cuenta (no resúmenes/minutas): referencia de estilo para la IA. */
function styleSamples(client: ClientRecord): string[] {
  return (client.activity?.recentMails ?? [])
    .filter((m) => m.direction === "me" && !isRecapMail(m) && m.excerpt.trim().length >= 40)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map((m) => m.excerpt.replace(/\s+/g, " ").trim().slice(0, 500));
}

/**
 * Entrada de la IA para Responder (`reply`) o Pedir status (`reminder`) + su huella (`client.replyAI` /
 * `client.reminderAI` valen mientras coincida) y el mapa ref → ticket para tildar lo que el cliente dio por hecho.
 */
export function clientMailRequest(
  mode: ClientMailMode,
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
) {
  const { requests, mails: pending } = pendingReplies(client);
  const recent = [...(client.activity?.recentMails ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const lastOwn = [...recent].reverse().find((m) => m.direction === "me");
  // Recordatorio: lo que escribió el cliente desde mi último mail (para no pedir lo que ya avisaron).
  const mails = mode === "reply" ? pending : recent.filter((m) => m.direction === "client" && (!lastOwn || m.date > lastOwn.date)).slice(-4);
  const anchor = mode === "reply" ? (pending.at(-1) ?? null) : null;
  const recipients =
    mode === "reply"
      ? replyRecipients(client, meeting, anchor, pending, ownerEmail, settings)
      : interactionRecipients(client, meeting, latestInteraction(client, meeting), ownerEmail, settings);
  const own = accountActionables(client).filter((a) => boardSide(client, a, settings) === "debo");
  const openOwn = own.filter((a) => !a.done).slice(0, 15);
  const openClient = reminderSteps(client, ownerEmail, settings).slice(0, 15);
  const refs = new Map<string, string>([
    ...openOwn.map((a, i) => [`A${i + 1}`, a.id] as [string, string]),
    ...openClient.map((a, i) => [`C${i + 1}`, a.id] as [string, string]),
  ]);
  const input: ClientMailInput = {
    mode,
    clientName: companyName(client),
    ownerName: settings.ownerAliases[0] ?? "PM",
    today: fmtDate(new Date().toISOString()),
    recipients: recipients.map((r) => (r.name && !r.name.includes("@") ? r.name.split(/\s+/)[0] : r.email)),
    erp: client.profile?.erp || null,
    mails: mails.map((m) => ({
      from: m.fromName ?? m.from,
      date: fmtShort(m.date),
      text: m.excerpt.replace(/\s+\n/g, "\n").trim().slice(0, 1500),
      ...(m.thirdParty && { thirdParty: true }),
    })),
    lastOwnMail: lastOwn ? lastOwn.excerpt.replace(/\s+/g, " ").trim().slice(0, 700) : null,
    requests: requests.map((r) => r.title),
    openOwn: openOwn.map((a, i) => ({ ref: `A${i + 1}`, text: stepText(client, a) })),
    openClient: openClient.map((a, i) => ({ ref: `C${i + 1}`, text: stepText(client, a) })),
    doneOwn: own.filter((a) => a.done).slice(0, 15).map((a) => stepText(client, a)),
    styleSamples: styleSamples(client),
    attention: Boolean(client.profile?.attention),
  };
  const worth = mode === "reply" ? requests.length > 0 || pending.length > 0 : openClient.length > 0;
  return { input, key: clientMailKey(input), worth, recipients, anchor, mails: pending, refs };
}

/** Compatibilidad: entrada de la respuesta. */
export const replyAIRequest = (client: ClientRecord, meeting: DiscoveredMeeting, ownerEmail: string | null, settings: WorkSettings) =>
  clientMailRequest("reply", client, meeting, ownerEmail, settings);

/** A quién responder: quienes escribieron (lado cliente); si no hay mails a mano, los de la última interacción. */
function replyRecipients(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  anchor: MailRef | null,
  mails: MailRef[],
  ownerEmail: string | null,
  settings: WorkSettings,
): { email: string; name: string | null }[] {
  if (!anchor) return interactionRecipients(client, meeting, latestInteraction(client, meeting), ownerEmail, settings);
  const people = new Map(computeParticipants(client, ownerEmail).map((p) => [p.email, p.name]));
  const seen = new Map<string, string | null>();
  for (const m of [...mails].reverse()) {
    const email = m.from.toLowerCase();
    if (!seen.has(email)) seen.set(email, people.get(email) ?? m.fromName ?? null);
  }
  return [...seen].map(([email, name]) => ({ email, name }));
}

/**
 * Respuesta a lo que el cliente espera (botón "Responder" del Pulso de cuentas): todos sus mails con consultas o
 * pedidos sin contestar, en un solo mail, en el hilo del más reciente (editable en el composer) y con Cc a quienes
 * participaron de los otros hilos. El cuerpo lo redacta la IA (`client.replyAI`, modelo barato) si está vigente; si
 * no, por reglas con la lista de consultas para completar.
 */
export function buildReply(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): FollowupDraft {
  const now = new Date();
  const { key, recipients, anchor, mails } = replyAIRequest(client, meeting, ownerEmail, settings);
  const { requests, ticketIds } = pendingReplies(client);
  const one = recipients.length === 1;
  const ai = client.replyAI?.key === key ? client.replyAI : null;
  const reviewNotes: string[] = [];
  let body: string[];
  if (ai) {
    body = ai.cuerpo.trim().split("\n");
    reviewNotes.push(`Redactado con IA (${ai.model}) en tu tono: revisá cada respuesta antes de enviar.`, ...resolvedNotes(ai), ...ai.revision);
  } else if (requests.length) {
    body = [
      `Gracias por ${one ? "tu" : "su"} mensaje. Sobre lo que ${one ? "consultas" : "consultan"}:`,
      "",
      ...requests.map((r) => `• ${r.title}`),
      "",
      `Lo estoy revisando y ${one ? "te" : "les"} confirmo a la brevedad.`,
    ];
    reviewNotes.push("Respuesta por reglas: completá cada punto o usá Actualizar para que la IA la redacte.");
  } else {
    body = [`Gracias por ${one ? "tu" : "su"} mensaje.`];
    reviewNotes.push("No hay consultas detectadas sin responder: revisá si hace falta este mail.");
  }
  if (mails.length > 1) reviewNotes.push(`Responde ${mails.length} mails en uno solo; elegí el hilo en "Dónde" si preferís otro.`);
  const others = mails.filter((m) => anchor && m.threadId !== anchor.threadId);
  if (others.length) reviewNotes.push("Hay consultas en otros hilos: sus participantes van en Cc.");
  const thread = anchor ? null : pickFollowupThread(client);
  if (thread) reviewNotes.unshift(...thread.notes);
  const baseCc = anchor ? replyAllCc(client, anchor.threadId, ownerEmail, recipients) : newMailCc(client, ownerEmail, recipients);
  const extra = others.flatMap((m) => [m.from, ...(m.recipients ?? [])].map((e) => e.toLowerCase()));

  return {
    meetingId: meeting.id,
    subject: anchor
      ? `Re: ${cleanSubject(anchor.subject)}`
      : thread?.subject
        ? `Re: ${cleanThreadSubject(thread.subject)}`
        : `Consultas – ${companyName(client)}`,
    body: [greet(recipients, client), "", ...body, "", "Saludos"].join("\n"),
    to: recipients.map((r) => r.email),
    cc: withStrayCc(baseCc, extra, ownerEmail, recipients),
    updatedAt: now.toISOString(),
    threadId: anchor ? anchor.threadId : thread!.threadId,
    threadReason: anchor ? "anchor" : thread!.reason,
    reviewNotes,
    replyTicketIds: ticketIds,
    ...(ai && { ai: true }),
  };
}

/** Respuesta sugerida (`buildReply`) + cuántas consultas/pedidos responde. */
export function getReplyDraft(client: ClientRecord, meeting: DiscoveredMeeting, ownerEmail: string | null, settings: WorkSettings) {
  return {
    kind: "reply" as const,
    count: pendingReplies(client).requests.length,
    ...getDraft("reply", client, meeting, ownerEmail, settings),
  };
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
  /** Solo `reminder`: recordatorio de un solo punto. */
  ticketId?: string | null,
): { draft: FollowupDraft; generated: FollowupDraft; regenerated: boolean; lastSentAt: string | null } {
  const generated =
    kind === "reply"
      ? buildReply(client, meeting, ownerEmail, settings)
      : kind === "status"
      ? buildStatusUpdate(client, meeting, ownerEmail, settings)
      : kind === "reminder"
        ? buildReminder(client, meeting, ownerEmail, settings, ticketId)
        : buildFollowup(client, meeting, ownerEmail, settings);
  const saved = client.followups?.[followupKey(kind, meeting.id, kind === "reminder" ? ticketId : null)];
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

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
/** Responsables que son un área o buzón, no una persona. */
const GENERIC_OWNER = /^(operaciones|administraci[oó]n|compras|cuentas|contabilidad|finanzas|soporte|sistemas|tesorer[ií]a|proveedores|pagos|facturaci[oó]n|la empresa|el cliente|equipo)$/i;

/** Lunes (AAAA-MM-DD, hora local) de la semana de `d`: misma clave que `weekKey` del job. */
function mondayKey(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}
/** Número de semana estable (desde 1970) + huella del cliente: rota saludo y tono por semana y no todos a la vez. */
function weekSeed(clientId: string, d: Date): number {
  let h = 0;
  for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.floor(Date.parse(`${mondayKey(d)}T12:00:00Z`) / (7 * 86_400_000)) + Math.abs(h);
}
/** Saludos del lunes: `{n}` = nombre o "equipo"; [ustedes, vos]. */
const WEEKLY_GREETINGS: [string, string][] = [
  ["Buen día {n}, excelente inicio de semana.", "Buen día {n}, excelente inicio de semana."],
  ["Hola {n}, ¿cómo arrancan la semana?", "Hola {n}, ¿cómo arrancas la semana?"],
  ["Buen día {n}, espero que hayan tenido un lindo fin de semana.", "Buen día {n}, espero que hayas tenido un lindo fin de semana."],
  ["Hola {n}, buen comienzo de semana.", "Hola {n}, buen comienzo de semana."],
  ["Buen día {n}, que tengan una excelente semana.", "Buen día {n}, que tengas una excelente semana."],
  ["Hola {n}, espero que estén muy bien. Que tengan una buena semana.", "Hola {n}, espero que estés muy bien. Que tengas una buena semana."],
];
const WEEKLY_TONES = [
  "breve y directo, al grano",
  "cálido y cercano, como con alguien con quien ya hay confianza",
  "práctico y ordenado, con foco en cerrar los temas esta semana",
  "relajado y de equipo, sin sonar formal",
  "positivo, transmitiendo que vamos bien encaminados",
];
const WEEKLY_OPENINGS = [
  "anclá la apertura en la última interacción de <contexto> (reunión o mail, con su día) y pasá a lo que necesito de su lado",
  "contá que sigo con lo que quedó de mi lado (sin decir que está terminado) y que les paso novedades en estos días; mientras tanto, lo que necesito",
  "planteá que esta semana me gustaría cerrar estos temas y que de mi lado ya estoy avanzando",
  "decí que para seguir avanzando (o no frenar) necesito una mano con algunos puntos de su lado",
  "si <contexto> tiene un objetivo cercano (próxima reunión o fecha acordada), arrancá por eso: para llegar a eso necesito estos puntos",
];
const WEEKLY_CLOSINGS = [
  "atá el cierre a lo que viene según <contexto> (la próxima reunión, validar en producción, definir la fecha de salida); si no hay nada, invitá a confirmar cuando lo tengan",
  "ofrecé ayuda si algo se traba o necesitan una mano",
  "proponé que si algo no se puede esta semana me avisen y lo reordenamos",
  "agradecé la mano de su lado y pedí que me avisen cualquier duda",
  "ofrecé una llamada corta si es más fácil verlo juntos",
];
/** Saludo de esta semana; no repite el de la semana anterior. */
function weeklyGreeting(clientId: string, now: Date, name: string | null, plural: boolean): string {
  const seed = weekSeed(clientId, now);
  const pick = (k: number) => WEEKLY_GREETINGS[k % WEEKLY_GREETINGS.length][plural ? 0 : 1];
  return pick(seed).replace("{n}", name ?? "equipo");
}

/** Lunes 00:00 (hora local) de la semana anterior a `now`: inicio de "la semana pasada" del mail de los lunes. */
function previousMonday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7);
}

/** Datos del mail de los lunes: lo mismo alimenta la plantilla por reglas y la entrada de la IA. */
function weeklyParts(client: ClientRecord, meeting: DiscoveredMeeting, ownerEmail: string | null, settings: WorkSettings, now: Date) {
  const base = buildStatusUpdate(client, meeting, ownerEmail, settings);
  const since = previousMonday(now).getTime();
  const all = accountActionables(client);
  const dueAt = (a: (typeof all)[number]) => {
    const due = agreedDue(client, a.id, a.step, a.meeting.date, settings.workDays);
    // Una fecha "acordada" a más de 120 días es un dd/mm ya pasado que se corrió al año siguiente: no se usa.
    return due && due.until >= now && due.until.getTime() - now.getTime() < 120 * 86_400_000 ? due : null;
  };
  const dueOf = (a: (typeof all)[number]) => dueAt(a)?.label ?? null;
  const sideOf = (a: (typeof all)[number]) => overrideSide(client, a.id, stepSide(a.step, client, ownerEmail, settings));
  const open = all.filter((a) => !a.done);
  const done = new Set(client.doneTicketIds ?? []);
  const doneAt = client.doneTicketAt ?? {};
  const mailAll = mailTickets(client).filter((t) => t.kind === "request" || t.kind === "commitment");
  const mailOpen = mailAll.filter((t) => !done.has(t.id));
  const recent = (at: string | null | undefined) => Boolean(at && Date.parse(at) >= since);
  const recipients = base.to.map((email) => ({ email, name: null as string | null }));
  const hello = greet(recipients, client);
  const names = hello.startsWith("Hola equipo") ? [] : hello.replace(/^Hola\s+/, "").replace(/,$/, "").split(/,\s*|\s+y\s+/);
  return {
    base,
    hello,
    names,
    // Tuteo solo con una persona identificada (los buzones genéricos en Para no cuentan); si no, "ustedes".
    plural: names.length !== 1 || base.to.filter((e) => !GENERIC_MAILBOX.test(e)).length > 1,
    dueOf,
    dueAt,
    ours: open.filter((a) => ["me", "team"].includes(sideOf(a))),
    theirs: open.filter((a) => sideOf(a) === "client"),
    shared: open.filter((a) => sideOf(a) === "shared"),
    other: open.filter((a) => sideOf(a) === "unknown"),
    requests: mailOpen.filter((t) => t.kind === "request"),
    commitments: mailOpen.filter((t) => t.kind === "commitment"),
    finished: [
      ...all.filter((a) => a.done && recent(a.doneAt)).map((a) => ({ text: `${formatStep(a.step)}${ownerTag(a.step)}`, at: a.doneAt! })),
      ...mailAll.filter((t) => done.has(t.id) && recent(doneAt[t.id])).map((t) => ({ text: t.title, at: doneAt[t.id] })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/**
 * Últimos 3 mails semanales a la cuenta, el más reciente primero: el texto que REALMENTE envié (`outcome.body`) si
 * lo hay; si no, el borrador. Los que borré no cuentan.
 */
function previousWeeklyBodies(client: ClientRecord, now: Date): string[] {
  const current = `week:${mondayKey(now)}`;
  return Object.keys(client.followups ?? {})
    .filter((k) => k.startsWith("week:") && k < current)
    .filter((k) => client.followups![k].outcome?.state !== "deleted")
    .sort()
    .reverse()
    .slice(0, 3)
    .map((k) => {
      const f = client.followups![k];
      return (f.outcome?.body ?? f.gmailBody ?? f.body ?? "").trim().slice(0, 1500);
    })
    .filter(Boolean);
}

/**
 * Contexto para anclar apertura y cierre: última reunión y último mail DEL CLIENTE (solo si son de los últimos
 * 14 días; algo más viejo no sirve de ancla) y la fecha acordada más próxima.
 */
function weeklyContext(client: ClientRecord, meeting: DiscoveredMeeting, anchor: string | null, now: Date): string[] {
  const recent = (iso: string) => now.getTime() - Date.parse(iso) <= 14 * 86_400_000;
  const out: string[] = [];
  if (recent(meeting.date)) out.push(`Última reunión con el cliente: ${fmtDate(meeting.date)}${meeting.title ? ` (${meeting.title.slice(0, 80)})` : ""}`);
  const inbound = client.activity?.lastInboundMail;
  if (inbound && recent(inbound.date)) {
    out.push(`Último mail que ME escribió el cliente: ${fmtDate(inbound.date)}, de ${inbound.fromName ?? inbound.from}: "${inbound.excerpt.replace(/\s+/g, " ").slice(0, 220)}"`);
  }
  if (anchor) out.push(`Fecha acordada más próxima: ${anchor}`);
  return out.length ? out : ["(sin interacciones recientes: no anclar la apertura en una fecha)"];
}

/** Entrada de la IA para el mail de los lunes y su huella; `null` si no queda nada pendiente con la cuenta. */
export function weeklyAIRequest(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
  now = new Date(),
  /** Mails semanales enviados de otras cuentas (`weeklyStyleExamples`); no entran en la huella. */
  styleExamples: string[] = [],
): { input: WeeklyMailInput; key: string; ticketIds: string[] } | null {
  const p = weeklyParts(client, meeting, ownerEmail, settings, now);
  const items = [...p.theirs, ...p.shared];
  // Sin nada que pedirle al cliente no hay mail de los lunes (un mail sin puntos se borraba siempre).
  if (!items.length) return null;
  // Responsables del lado del cliente: yo y el equipo Xtract no figuran ("Kazaro y Alexis" → "Kazaro").
  const clientOwners = (step: string) => {
    const owners = step.match(/^\s*\[([^\]]+)\]/)?.[1].split(",").map((o) => o.trim()).filter(Boolean) ?? [];
    const keep = owners.filter((o) => !isGroupOwner(o) && !isOwnActionable(`[${o}] x`, settings) && learnedRole(o, settings) !== "team");
    // El nombre de la empresa o de un buzón genérico ("Gaviglio", "Operaciones") no aporta como responsable.
    const company = norm(companyName(client));
    const named = keep.filter((o) => norm(o) !== company && norm(o) !== norm(client.name) && !GENERIC_OWNER.test(o.trim()));
    return ownerTag(named.length ? `[${named.join(", ")}] x` : "x").replace(/^ \((.*)\)$/, "$1") || null;
  };
  const anchor = items
    .map((a) => p.dueAt(a))
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .sort((a, b) => a.until.getTime() - b.until.getTime())[0];
  const input: WeeklyMailInput = {
    clientName: companyName(client),
    ownerName: settings.ownerAliases[0] ?? "PM",
    today: fmtDate(now.toISOString()),
    recipients: p.names,
    plural: p.plural,
    erp: client.profile?.erp || null,
    anchorDate: anchor?.label ?? null,
    clientItems: items.map((a, i) => ({
      ref: `P${i + 1}`,
      text: formatStep(a.step),
      owner: clientOwners(a.step),
      due: p.dueOf(a),
    })),
    attention: Boolean(client.profile?.attention),
    tone: WEEKLY_TONES[weekSeed(client.id, now) % WEEKLY_TONES.length],
    angle: {
      opening: WEEKLY_OPENINGS[weekSeed(client.id, now) % WEEKLY_OPENINGS.length],
      closing: WEEKLY_CLOSINGS[(weekSeed(client.id, now) + 2) % WEEKLY_CLOSINGS.length],
    },
    previousMails: previousWeeklyBodies(client, now),
    context: weeklyContext(client, meeting, anchor?.label ?? null, now),
    styleExamples,
  };
  return { input, key: weeklyKey(input), ticketIds: items.map((a) => a.id) };
}

/**
 * Mail de los lunes. Con `ai` (redacción de `generateWeeklyMail` para la entrada de `weeklyAIRequest`): saludo de
 * inicio de semana → avance general nuestro → conector → lista numerada de lo que necesitamos de su lado → cierre.
 * Sin IA, por reglas: lo completado la semana pasada (calendario, lunes a hoy) + objetivos de cada lado. Las fechas
 * solo si se acordaron (nunca la meta interna). `null` si no queda nada pendiente con la cuenta.
 */
export function buildWeeklyPlan(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
  now = new Date(),
  ai?: { output: WeeklyMailOutput; key: string } | null,
): FollowupDraft | null {
  const req = weeklyAIRequest(client, meeting, ownerEmail, settings, now);
  if (!req) return null;
  const p = weeklyParts(client, meeting, ownerEmail, settings, now);
  const subject = p.base.threadId ? p.base.subject : `Objetivos de la semana – ${companyName(client)}`;

  if (ai && ai.key === req.key) {
    const out = ai.output;
    const { input } = req;
    const byRef = new Map(out.items.map((i) => [i.ref, i]));
    // Una sola persona dueña de todo: no se repite su nombre en cada punto.
    const solo = !input.plural && input.clientItems.every((i) => !i.owner || i.owner === input.recipients[0]);
    const rows = input.clientItems.map((item, i) => {
      const w = byRef.get(item.ref);
      const action = (w?.titulo.trim() || item.text).replace(/[.:]+$/, "");
      const who = !solo && item.owner ? ` (${item.owner})` : "";
      const desc = (w?.descripcion.trim() || "").replace(/\.?$/, ".");
      const due = item.due ? ` *(acordado para ${item.due.startsWith("semana") ? "la" : "el"} ${item.due})*` : "";
      return `${i + 1}. **${action}${who}:** ${desc === "." ? "" : desc}${due}`.trimEnd();
    });
    const opening =
      out.apertura.trim() ||
      `Estoy avanzando con los puntos pendientes que quedaron de mi lado, de todas formas, necesito que avancemos con los puntos pendientes del lado de ${input.plural ? "ustedes" : "vos"}:`;
    const lines = [
      weeklyGreeting(client.id, now, input.plural ? null : (input.recipients[0] ?? null), input.plural),
      "",
      opening,
      ...(rows.length ? ["", ...rows] : []),
      "",
      out.cierre.trim(),
      "Saludos",
    ];
    return { ...p.base, subject, body: lines.join("\n"), reviewNotes: ["Redactado con IA", ...out.revision], ai: true, aiKey: req.key };
  }

  const line = (a: (typeof p.ours)[number]) => {
    const due = p.dueOf(a);
    return `${formatStep(a.step)}${due ? ` – para ${due.startsWith("semana") ? "la" : "el"} ${due}` : ""}${ownerTag(a.step)}`;
  };
  const pend = (text: string) => `• ${text}${STATUS_PENDING}`;
  const section = (title: string, rows: string[]) => (rows.length ? ["", title, ...rows] : []);
  const your = p.plural ? "su" : "tu";
  const lines = [
    p.hello,
    "",
    `${p.plural ? "Les" : "Te"} comparto los objetivos de esta semana para seguir avanzando con la integración.`,
    ...section(
      "Lo que completamos la semana pasada:",
      p.finished.map((f) => `✓ ${f.text}${doneStatus(f.at)}`),
    ),
    ...section("Objetivos de nuestro lado:", [...p.ours.map((a) => pend(line(a))), ...p.commitments.map((t) => pend(t.title))]),
    ...section(
      `Lo que ${p.plural ? "nos consultaron" : "nos consultaste"} por mail (ya lo estamos viendo):`,
      p.requests.map((t) => pend(t.title)),
    ),
    ...section(`Objetivos de ${your} lado (para poder avanzar):`, p.theirs.map((a) => pend(line(a)))),
    ...section("Para resolver en conjunto:", p.shared.map((a) => pend(line(a)))),
    ...section("Otros pendientes acordados:", p.other.map((a) => pend(line(a)))),
    "",
    `La idea es cerrar estos puntos en el transcurso de la semana. Cualquier duda o si hay algo para priorizar, ${p.plural ? "me avisan" : "me avisas"}.`,
    "",
    "Saludos",
  ];
  return { ...p.base, subject, body: lines.join("\n"), reviewNotes: [] };
}

/** Entrada de la IA para el mail de seguimiento vigente (la misma que arma `buildStatusUpdate`) y su huella. */
export function statusAIRequest(
  client: ClientRecord,
  meeting: DiscoveredMeeting,
  ownerEmail: string | null,
  settings: WorkSettings,
): { input: StatusMailInput; key: string; worth: boolean } {
  const captured: { input?: StatusMailInput } = {};
  buildStatusUpdate(client, meeting, ownerEmail, settings, captured);
  const input = captured.input!;
  // Vale la pena redactar con IA si hay algo que contar (avances, consultas o pendientes) .
  return { input, key: statusKey(input), worth: input.sections.length > 0 };
}
