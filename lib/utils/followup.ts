import {
  followupKey,
  type ClientRecord,
  type DiscoveredMeeting,
  type FollowupDraft,
  type FollowupKind,
  type MailRef,
} from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { computeParticipants, isOwnTeamEmail, type Participant } from "@/lib/utils/participants";
import { isGroupOwner, isOwnActionable } from "@/lib/utils/capacity";
import { isRecapMail, mailTickets, relatedMailNote } from "@/lib/utils/mail-tickets";
import { accountActionables } from "@/lib/utils/actionables";
import { parseStep, type StepDue } from "@/lib/utils/gemini-notes-parser";

// Borradores por reglas (sin LLM), recalculados con cada mail, reunión o accionable tildado.
// Follow-up: hitos, decisiones y accionables para la próxima sesión (última minuta + arrastrados +
// pedidos por mail). Seguimiento: avances del tablero desde mi último mail posterior a la reunión,
// partiendo de la última interacción. Se persisten solo al editarlos, crear el draft en Gmail o
// enviarlos (`client.followups`). Lo que requiere revisión va en `reviewNotes`,
// nunca en el cuerpo: los borradores automáticos llegan a Gmail sin pasar por la UI.

const fmtShort = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "2-digit" });

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

/** "[Ana Pérez] Enviar X: detalle" → "Enviar X: detalle (Ana Pérez)". */
function formatStep(step: string): string {
  const m = step.match(/^\s*\[([^\]]+)\]\s*(.+)$/);
  return m ? `${m[2].trim()} (${m[1].trim()})` : step.trim();
}

const senderNames = (client: ClientRecord) =>
  new Map(
    (client.activity?.recentMails ?? client.activity?.recentInbound ?? [])
      .filter((m) => m.fromName)
      .map((m) => [m.from, m.fromName!]),
  );

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

/** Follow-up: hitos y decisiones de la reunión + accionables vigentes, al día con mails y tablero. */
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
  const steps: { text: string; side: StepSide; done: boolean }[] = actionables.map((a) => ({
    text:
      `${formatStep(a.step)}${a.done ? "" : dueSuffix(parseStep(a.step, a.meeting.date).due, now)}` +
      (!a.done && trace.has(a.id) ? ` (conversado por mail el ${fmtShort(trace.get(a.id)!.date)})` : "") +
      (a.done && a.doneAt ? ` (${fmtShort(a.doneAt)})` : "") +
      (!a.done && a.carried ? ` [acordado el ${fmtShort(a.meeting.date)}]` : ""),
    side: stepSide(a.step, client, ownerEmail, settings),
    done: a.done,
  }));
  const requests = openRequests(client, interaction).map((r) => ({
    text: `${r.title} (consulta por mail)`,
    side: "team" as StepSide,
    done: false,
  }));
  const open = [...steps.filter((s) => !s.done), ...requests];
  const bullets = (items: typeof steps) => items.map((s) => `• ${s.text}`);
  const group = (title: string, items: typeof steps) => (items.length ? ["", title, ...bullets(items)] : []);
  const agreed = (meeting.decisions ?? []).filter((d) => d.agreed).map((d) => `• ${d.text}`);
  const pending = (meeting.decisions ?? []).filter((d) => !d.agreed).map((d) => `• ${d.text}`);
  const milestones = (meeting.milestones ?? []).map((m) => `• ${m}`);

  const lines = [
    greet(recipients, client),
    "",
    `Gracias por el tiempo en la reunión del ${fmtDate(meeting.date)}. Les comparto lo conversado y cómo seguimos.`,
  ];
  if (meeting.summary) lines.push("", meeting.summary);
  if (milestones.length) lines.push("", "Hitos de la reunión:", ...milestones);
  if (agreed.length) lines.push("", "Decisiones acordadas:", ...agreed);
  if (pending.length) lines.push("", "Quedó por definir:", ...pending);
  if (open.length) {
    lines.push(
      "",
      "Accionables para la próxima sesión:",
      ...group("De nuestro lado:", open.filter((s) => s.side === "me" || s.side === "team")),
      ...group("De su lado:", open.filter((s) => s.side === "client")),
      ...group("En conjunto:", open.filter((s) => s.side === "shared")),
      ...group("Otros:", open.filter((s) => s.side === "unknown")),
    );
  }
  lines.push(...group("Ya avanzamos con:", steps.filter((s) => s.done)));
  lines.push("", "Si algo no quedó bien reflejado, avísenme y lo corregimos.", "", "Saludos,");

  const reviewNotes = lastTalkNote(interaction);
  if (!meeting.summary) reviewNotes.push("La minuta no trae resumen: agregalo si hace falta.");
  if (meeting.milestones === undefined) {
    reviewNotes.push("Esta minuta todavía no se reprocesó: los hitos y decisiones aparecen después de la próxima sincronización.");
  }
  if (!steps.length && !requests.length) reviewNotes.push("La minuta no trae próximos pasos: definí los accionables para la próxima sesión.");

  return {
    meetingId: meeting.id,
    subject: `Resumen y próximos pasos – ${meeting.title}`,
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    cc: newMailCc(client, ownerEmail, recipients),
    updatedAt: now.toISOString(),
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
    due: parseStep(a.step, a.meeting.date).due,
    side: stepSide(a.step, client, ownerEmail, settings),
  }));
  // Avances = tildados en el tablero desde mi último mail posterior a la reunión (o desde la reunión).
  const lastMine = (client.activity?.recentMails ?? [])
    .filter((m) => m.direction === "me" && m.date > meeting.date)
    .reduce<MailRef | null>((last, m) => (!last || m.date > last.date ? m : last), null);
  const since = lastMine?.date ?? meeting.date;
  // Lo completado incluye las consultas por mail que tildé, además de los accionables de la minuta.
  const doneAt = client.doneTicketAt ?? {};
  const completed = [
    ...steps
      .filter((s) => s.done && (!s.carried || (s.doneAt && s.doneAt >= meeting.date)))
      .map((s) => ({ text: s.text, doneAt: s.doneAt })),
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
  // define el tablero, porque la relación se detecta por palabras clave.
  const trace = mailTrace(client, meeting);
  const related = pending.filter((s) => trace.has(s.id));
  const open = pending.filter((s) => !trace.has(s.id));
  const tag = (s: (typeof steps)[number]) =>
    `${dueSuffix(s.due, now)}${s.carried ? ` [acordado el ${fmtShort(s.meeting.date)}]` : ""}`;
  const ours = open.filter((s) => s.side === "me" || s.side === "team");
  const theirs = open.filter((s) => s.side === "client");
  const shared = open.filter((s) => s.side === "shared");
  const other = open.filter((s) => s.side === "unknown");
  const requests = openRequests(client, interaction);
  const recipients = interactionRecipients(client, meeting, interaction, ownerEmail);
  const meetingRef = `la reunión del ${fmtDate(meeting.date)}`;
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
      ...advanced.map((c) => `✓ ${c.text} (${fmtShort(c.doneAt!)})`),
    );
  }
  if (completedBefore.length) lines.push("", "Ya completado:", ...completedBefore.map((c) => `✓ ${c.text}`));
  if (related.length) {
    lines.push(
      "",
      "Conversado por mail desde la reunión:",
      ...related.map((s) => `• ${s.text}${tag(s)} (mail del ${fmtShort(trace.get(s.id)!.date)})`),
    );
  }
  if (ours.length) lines.push("", "En curso de nuestro lado:", ...ours.map((s) => `• ${s.text}${tag(s)}`));
  if (requests.length) lines.push("", "Sobre lo que nos consultaron, lo estamos revisando:", ...requests.map((r) => `• ${r.title}`));
  if (theirs.length) lines.push("", "Pendiente de su lado (para poder avanzar):", ...theirs.map((s) => `• ${s.text}${tag(s)}`));
  if (shared.length) lines.push("", "Para resolver en conjunto:", ...shared.map((s) => `• ${s.text}${tag(s)}`));
  if (other.length) lines.push("", "Otros pendientes acordados:", ...other.map((s) => `• ${s.text}${tag(s)}`));
  lines.push("", "Cualquier duda o si hay algo para priorizar, me avisan.", "", "Saludos,");

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

  return {
    meetingId: meeting.id,
    subject: anchorMail ? `Re: ${cleanSubject(anchorMail.subject)}` : `Actualización de avance – ${companyName(client)}`,
    body: lines.join("\n"),
    to: recipients.map((r) => r.email),
    cc: anchorMail
      ? replyAllCc(client, anchorMail.threadId, ownerEmail, recipients)
      : newMailCc(client, ownerEmail, recipients),
    updatedAt: now.toISOString(),
    ...(anchorMail ? { threadId: anchorMail.threadId } : {}),
    reviewNotes,
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
      },
      generated,
      regenerated: true,
      lastSentAt,
    };
  }
  return { draft: saved, generated, regenerated: false, lastSentAt };
}
