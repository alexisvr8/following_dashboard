import type { ClientRecord, MailRef, ThreadRef } from "@/lib/store/clients-store";

// Dónde va el borrador post-reunión (y el semanal / el de seguimiento sin mail de partida), en orden:
// 1) hilo fijado de la cuenta (⭐, `profile.followupThread`) mientras exista y Gmail lo acepte;
// 2) hilo con el asunto estándar ("Xtract + <Cliente> | … | Seguimiento") o de Etapa 2;
// 3) último hilo donde escribió el cliente o le escribí yo (no los solo del equipo);
// 4) mail nuevo con el asunto estándar (al crearlo queda fijado solo).
// Lo que el cliente escribió después en OTROS hilos se retoma en el elegido (línea en el mail + Cc).

export type ThreadReason = "pinned" | "standard" | "recent" | "new";

/** Gmail no agrega más de 100 mensajes a un hilo: pasado eso, la respuesta abre uno nuevo. */
export const GMAIL_THREAD_LIMIT = 100;

const STANDARD_SUBJECT = /xtract\s*\+.*\|\s*seguimiento|\betapa\s*2\b/i;

export const cleanThreadSubject = (s: string) => s.replace(/^\s*((re|rv|fw|fwd|tr|res|enc)\s*:\s*)+/i, "").trim();

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit" });

/** Asunto estándar de un mail nuevo de seguimiento: "Xtract + ACME | Integración | Tango | Seguimiento". */
export function standardSubject(client: ClientRecord): string {
  const name = client.profile?.emailName || client.name;
  return ["Xtract + " + name, "Integración", client.profile?.erp, "Seguimiento"].filter(Boolean).join(" | ");
}

export function pickFollowupThread(client: ClientRecord): {
  threadId: string | null;
  subject: string | null;
  reason: ThreadReason;
  notes: string[];
} {
  const notes: string[] = [];
  const pin = client.profile?.followupThread;
  if (pin) {
    const status = client.activity?.pinnedThread?.threadId === pin.threadId ? client.activity.pinnedThread : null;
    if (status?.missing) {
      notes.push(`El hilo fijado «${pin.subject}» ya no existe en Gmail: elegí otro en «Dónde» y fijalo con ⭐.`);
    } else if ((status?.messages ?? 0) >= GMAIL_THREAD_LIMIT) {
      notes.push(
        `El hilo fijado «${pin.subject}» llegó a ${GMAIL_THREAD_LIMIT} mensajes (Gmail no agrega más): este borrador va a otro hilo; fijá el nuevo con ⭐.`,
      );
    } else {
      return { threadId: pin.threadId, subject: pin.subject, reason: "pinned", notes };
    }
  }
  const std = (client.activity?.threads ?? []).find((t) => STANDARD_SUBJECT.test(t.subject));
  if (std) return { threadId: std.threadId, subject: std.subject, reason: "standard", notes };
  const live = [...(client.activity?.recentMails ?? [])]
    .filter((m) => m.direction !== "team")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (live) return { threadId: live.threadId, subject: live.subject, reason: "recent", notes };
  return { threadId: null, subject: null, reason: "new", notes };
}

/** Último mail del cliente por cada OTRO hilo, posterior a `since` (lo que mandó por separado). */
export function strayClientMails(client: ClientRecord, threadId: string | null, since: string): MailRef[] {
  if (!threadId) return [];
  const byThread = new Map<string, MailRef>();
  for (const m of client.activity?.recentMails ?? []) {
    if (m.direction !== "client" || m.threadId === threadId || m.date <= since) continue;
    const prev = byThread.get(m.threadId);
    if (!prev || m.date > prev.date) byThread.set(m.threadId, m);
  }
  return [...byThread.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Línea del mail que retoma en el hilo elegido lo que el cliente mandó por separado. */
export function strayLine(strays: MailRef[], one: boolean): string | null {
  if (!strays.length) return null;
  const list = strays.map((m) => `«${cleanThreadSubject(m.subject)}» (${shortDate(m.date)})`);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} y ${list.at(-1)}` : list[0];
  const whose = one ? "tu" : "su";
  return `Retomo en este hilo ${whose} ${strays.length > 1 ? "mails" : "mail"} ${joined} para tener todo el seguimiento en un solo lugar.`;
}

/** Participantes de los hilos sueltos (De/Para/Cc), para sumarlos en copia. */
export function strayParticipants(client: ClientRecord, strays: MailRef[]): string[] {
  const ids = new Set(strays.map((m) => m.threadId));
  const out = new Set<string>();
  for (const m of client.activity?.recentMails ?? []) {
    if (!ids.has(m.threadId)) continue;
    out.add(m.from.toLowerCase());
    for (const r of m.recipients ?? []) out.add(r.toLowerCase());
  }
  return [...out];
}

export function strayNotes(strays: MailRef[]): string[] {
  return strays.map(
    (m) =>
      `${m.fromName ?? m.from} escribió en otro hilo («${cleanThreadSubject(m.subject)}», ${shortDate(m.date)}): el borrador lo retoma en este hilo y suma a esa gente en Cc. Si preferís contestar allá, cambiá «Dónde».`,
  );
}

/** Hilos para el selector del composer: el fijado primero (aunque ya no esté entre los recientes). */
export function composerThreads(client: ClientRecord): ThreadRef[] {
  const threads = client.activity?.threads ?? [];
  const pin = client.profile?.followupThread;
  if (!pin) return threads;
  const found = threads.find((t) => t.threadId === pin.threadId);
  const pinned: ThreadRef = {
    threadId: pin.threadId,
    subject: found?.subject ?? pin.subject,
    date: found?.date ?? client.activity?.pinnedThread?.date ?? pin.pinnedAt,
    pinned: true,
  };
  return [pinned, ...threads.filter((t) => t.threadId !== pin.threadId)];
}
