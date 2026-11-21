import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting, MailRef } from "@/lib/store/clients-store";
import { DEFAULT_SETTINGS } from "@/lib/store/settings-store";
import { computeAlerts, replyQueue } from "@/lib/utils/followup-alerts";
import { openMailRequests } from "@/lib/utils/mail-tickets";
import { stepTicketId } from "@/lib/utils/actionables";
import { followupTicketId } from "@/lib/store/clients-store";
import { answeredRequests, collectMailItems } from "@/lib/utils/mail-items";
import { buildReply, pendingReplies } from "@/lib/utils/followup";
import { extractRequests } from "@/lib/utils/mail-classify";
import { clientTargets } from "@/lib/integrations/client-activity";
import { suggestFor } from "@/lib/integrations/unassigned-mail";

// Lunes 16/11; la reunión fue el martes 10/11 → 4 días hábiles sin interacción.
const NOW = new Date("2026-11-16T10:00:00-03:00");
const DAY = 86_400_000;
const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"], staleBusinessDays: 2 };

const meeting: DiscoveredMeeting = {
  id: "m1",
  docId: null,
  title: "Seguimiento",
  date: new Date(NOW.getTime() - 6 * DAY).toISOString(),
  summary: null,
  nextSteps: ["[Ana Pérez] Enviar accesos", "[Alexis Vásquez R] Configurar mapeo"],
};

const mail = (direction: MailRef["direction"], daysAgo: number, related: string[] = []): MailRef => ({
  messageId: `${direction}-${daysAgo}`,
  threadId: "t1",
  from: direction === "client" ? "ana@acme.com" : "colega@xtract.com",
  fromName: null,
  subject: "Asunto privado",
  date: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  excerpt: "",
  relatedTicketIds: related,
  direction,
});

const client = (over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: "acme.com",
  domain: "acme.com",
  name: "Acme",
  status: "assigned",
  contactEmails: ["ana@acme.com"],
  meetings: [meeting],
  trackingStatus: null,
  ...over,
});

const withMails = (mails: MailRef[]): Partial<ClientRecord> => ({
  activity: {
    syncedAt: NOW.toISOString(),
    lastMail: mails[0] ?? null,
    recentMails: mails,
    lastInboundMail: null,
    recentInbound: [],
    threads: [],
    lastCalendarMeeting: null,
    skipped: { invitation: 0, autoReply: 0, minutes: 0 },
  },
});

// Sin vencidos: minuta enviada y lo mío con fecha más adelante.
const onTime: Partial<ClientRecord> = {
  doneTicketIds: [followupTicketId("acme.com", "m1")],
  actionableDue: { [stepTicketId("acme.com", "m1", 1)]: "2026-11-30" },
};

describe("computeAlerts (Pulso de cuentas)", () => {
  it("cuenta en silencio con pendientes: entra, sin mostrar asuntos", () => {
    const [a] = computeAlerts([client()], settings, NOW);
    expect(a.kind).toBe("no_progress");
    expect(a.silentDays).toBe(4);
    expect(a.trail).toHaveLength(10);
    expect(a.lastMovementLabel).toMatch(/^Reunión del /);
    expect(a.reasons.some((r) => r.text.startsWith("Sin interacción hace 4"))).toBe(true);
  });

  it("reunión agendada dentro de 2 días hábiles: no entra", () => {
    const tomorrow = new Date(NOW.getTime() + DAY).toISOString();
    expect(computeAlerts([client()], settings, NOW, new Map([["acme.com", tomorrow]]))).toHaveLength(0);
    const later = new Date(NOW.getTime() + 4 * DAY).toISOString();
    expect(computeAlerts([client()], settings, NOW, new Map([["acme.com", later]]))).toHaveLength(1);
  });

  it("mail del equipo: cuenta solo si trata accionables míos", () => {
    const own = stepTicketId("acme.com", "m1", 1);
    const theirs = stepTicketId("acme.com", "m1", 0);
    // Viernes 13/11 → 1 día hábil: si cuenta, la cuenta no está en silencio.
    expect(computeAlerts([client({ ...onTime, ...withMails([mail("team", 3, [own])]) })], settings, NOW)).toHaveLength(0);
    expect(computeAlerts([client(withMails([mail("team", 3, [theirs])]))], settings, NOW)).toHaveLength(1);
    expect(computeAlerts([client(withMails([mail("team", 3)]))], settings, NOW)).toHaveLength(1);
  });

  it("posponer: hasta una fecha, o hasta la próxima interacción", () => {
    const until = new Date(NOW.getTime() + DAY).toISOString();
    expect(computeAlerts([client({ profile: { followupSnooze: { at: NOW.toISOString(), until } } })], settings, NOW)).toHaveLength(0);
    const at = new Date(NOW.getTime() - DAY).toISOString();
    expect(computeAlerts([client({ profile: { followupSnooze: { at } } })], settings, NOW)).toHaveLength(0);
    // Hubo un mail mío después de posponer y volvió el silencio → reaparece.
    const later = new Date(NOW.getTime() + 5 * DAY);
    const snoozedBefore = client({ ...withMails([mail("me", 0)]), profile: { followupSnooze: { at: new Date(NOW.getTime() - DAY).toISOString() } } });
    expect(computeAlerts([snoozedBefore], settings, later).length).toBe(1);
  });

  it("mail del cliente: Responder solo si pide o pregunta algo", () => {
    const inbound = (requests: string[], daysAgo: number): Partial<ClientRecord> => {
      const m = { ...mail("client", daysAgo), requests };
      return { activity: { ...withMails([m]).activity!, lastInboundMail: m, recentInbound: [m] } };
    };
    // Martes 10/11 → 4 días hábiles en silencio, con su consulta sin responder.
    const [a] = computeAlerts([client({ ...onTime, ...inbound(["¿Nos pasan el usuario del portal de proveedores?"], 6) })], settings, NOW);
    expect(a.kind).toBe("client_waiting");
    expect(a.actions[0]).toBe("reply");
    // Solo adjuntos (sin pedidos): entra por silencio, pero sin Responder.
    const [b] = computeAlerts([client({ ...onTime, ...inbound([], 6) })], settings, NOW);
    expect(b.kind).not.toBe("client_waiting");
    expect(b.actions).not.toContain("reply");
  });

  it("solo entra en silencio: un vencido o un pedido con contacto reciente no la traen", () => {
    expect(computeAlerts([client(withMails([mail("me", 0)]))], settings, NOW)).toHaveLength(0);
  });

  it("tildar un accionable cuenta como interacción", () => {
    const own = stepTicketId("acme.com", "m1", 1);
    const ticked = client({ doneTicketIds: [own], doneTicketAt: { [own]: new Date(NOW.getTime() - 3 * DAY).toISOString() } });
    expect(computeAlerts([ticked], settings, NOW)).toHaveLength(0);
  });

  it("reunión esta semana: fuera hasta el lunes siguiente", () => {
    const monday: DiscoveredMeeting = { ...meeting, date: NOW.toISOString() };
    const friday = new Date(NOW.getTime() + 4 * DAY); // 4 días hábiles después, misma semana
    expect(computeAlerts([client({ meetings: [monday] })], settings, friday)).toHaveLength(0);
    const nextMonday = new Date(NOW.getTime() + 7 * DAY);
    expect(computeAlerts([client({ meetings: [monday] })], settings, nextMonday)).toHaveLength(1);
  });

  it("acciones: avances y pedir status cuando hay puntos de ambos lados", () => {
    const [a] = computeAlerts([client()], settings, NOW);
    expect(a.actions).toEqual(["status", "reminder"]);
  });

  it("sin nada abierto de ningún lado: no entra", () => {
    const old: DiscoveredMeeting = { ...meeting, date: new Date(NOW.getTime() - 20 * DAY).toISOString(), nextSteps: [] };
    expect(computeAlerts([client({ meetings: [old] })], settings, NOW)).toHaveLength(0);
  });
});

describe("Responder (pedidos por mail)", () => {
  const ask = (requests: string[], threadId = "t1"): MailRef => ({ ...mail("client", 3), threadId, requests });
  const activity = (mails: MailRef[]): Partial<ClientRecord> => {
    const inbound = mails.filter((m) => m.direction === "client").sort((a, b) => b.date.localeCompare(a.date));
    return { activity: { ...withMails(mails).activity!, lastInboundMail: inbound[0] ?? null, recentInbound: inbound } };
  };

  it("pedido contestado en su hilo (mail nuestro posterior) → respondido; en otro hilo sigue abierto", () => {
    const req = ask(["¿Nos pasan el usuario del portal de proveedores?"]);
    const sameThread = client(activity([req, { ...mail("me", 1), threadId: "t1" }]));
    expect(answeredRequests(sameThread, collectMailItems(sameThread))).toHaveLength(1);
    const otherThread = client(activity([req, { ...mail("me", 1), threadId: "t2" }]));
    expect(answeredRequests(otherThread, collectMailItems(otherThread))).toHaveLength(0);
  });

  it("cuenta activa con pedidos: no es tarjeta, va a la franja Por responder; Quitar la saca", () => {
    const base = client({ ...onTime, ...activity([ask(["¿Nos pasan el usuario del portal de proveedores?"])]) });
    const alerts = computeAlerts([base], settings, NOW);
    expect(alerts).toHaveLength(0);
    const [q] = replyQueue([base], alerts);
    expect(q.count).toBe(1);
    const ids = openMailRequests(base).map((t) => t.id);
    expect(replyQueue([{ ...base, removedTicketIds: ids }], [])).toHaveLength(0);
  });

  it("borrador de respuesta: un solo mail en el hilo más reciente, con los pedidos de varios mails", () => {
    const c = client(
      activity([
        { ...ask(["¿Nos pasan el usuario del portal de proveedores?"], "t1"), messageId: "a" },
        { ...ask(["¿Cuándo arranca la carga de facturas de diciembre?"], "t2"), messageId: "b", date: new Date(NOW.getTime() - DAY).toISOString() },
      ]),
    );
    const d = buildReply(c, meeting, null, settings);
    expect(d.threadId).toBe("t2");
    expect(d.replyTicketIds).toHaveLength(3); // 2 pedidos + "Responder" del último mail
    expect(d.body).toContain("portal de proveedores");
    expect(d.body).toContain("facturas de diciembre");
    expect(d.ai).toBeUndefined();
  });
});

describe("Dominios vinculados (profile.linkedContacts)", () => {
  it("exclusivo: se busca y cuenta como de la cuenta; compartido: no se busca ni se asigna solo", () => {
    const c = client({
      profile: {
        linkedContacts: [
          { value: "externos.partner.com.ar", shared: false },
          { value: "dev@solo.com", shared: false },
          { value: "erp-partner.com.ar", shared: true },
        ],
      },
    });
    const { query, matches } = clientTargets(c, null, new Set());
    expect(query).toEqual(expect.arrayContaining(["@acme.com", "@externos.partner.com.ar", "dev@solo.com"]));
    expect(query.some((q) => q.includes("erp-partner"))).toBe(false);
    expect(matches("ana@externos.partner.com.ar")).toBe(true);
    expect(matches("dev@solo.com")).toBe(true);
    expect(matches("x@erp-partner.com.ar")).toBe(false);
  });
});

describe("Detector de pedidos", () => {
  it("ignora texto citado de nuestra plantilla y detecta 'les pido que'", () => {
    expect(extractRequests("Alex,\nEste punto ya esta resuelto.\n* Enviar despachos prueba (Maru) - Status: Pendiente ⏳ Saludos,")).toHaveLength(0);
    expect(extractRequests("Les cuento, les pido que quede cargado de forma masiva el almacen 15 para todos.")).toHaveLength(1);
  });

  it("Responder toma todo lo que el cliente escribió después de mi último mail, aunque no traiga pedidos", () => {
    const mine = { ...mail("me", 3), threadId: "t1", messageId: "m0" };
    const confirm = { ...mail("client", 2), threadId: "t1", messageId: "c1", from: "adri@acme.com", requests: [] };
    const ask = { ...mail("client", 1), threadId: "t1", messageId: "c2", from: "maru@acme.com", requests: ["Les pido que quede cargado el almacén 15 para todos los proveedores."] };
    const c = client({ activity: { ...withMails([ask, confirm, mine]).activity!, lastInboundMail: ask, recentInbound: [ask, confirm] } });
    const p = pendingReplies(c);
    expect(p.mails.map((m) => m.messageId)).toEqual(["c1", "c2"]);
    const d = buildReply(c, meeting, null, settings);
    expect(d.to).toEqual(["maru@acme.com", "adri@acme.com"]);
  });
});

describe("Tildes automáticos de la sync", () => {
  it("un pedido por mail tildado hoy por la sync no cuenta como interacción", () => {
    const id = "acme.com:mail-x1-0";
    const c = client({ doneTicketIds: [id], doneTicketAt: { [id]: NOW.toISOString() } });
    expect(computeAlerts([c], settings, NOW)).toHaveLength(1);
  });

  it("un pedido contestado en su hilo queda con la fecha de nuestra respuesta", () => {
    const req: MailRef = { ...mail("client", 5), threadId: "t1", messageId: "r1", requests: ["¿Nos pasan el usuario del portal de proveedores?"] };
    const answer: MailRef = { ...mail("me", 4), threadId: "t1", messageId: "a1" };
    const c = client({ activity: { ...withMails([answer, req]).activity!, lastInboundMail: req, recentInbound: [req] } });
    const [hit] = answeredRequests(c, collectMailItems(c));
    expect(hit.at).toBe(answer.date);
  });
});

describe("Mails sin cuenta: sugerencias", () => {
  const werthein = client({ id: "wertheinagro.com", domain: "wertheinagro.com", name: "Wertheinagro", profile: { linkedContacts: [{ value: "acsistec.com.ar", shared: true }] } });
  const other = client({ id: "glam.com.ar", domain: "glam.com.ar", name: "GLAM Distribuciones" });

  it("lo nombra en el asunto o el cuerpo → sugerencia fuerte", () => {
    const [s] = suggestFor([werthein, other], "x@idero.com.ar", "Consulta integración Wertheinagro", "Hola, sobre la cuenta…", "Hola");
    expect(s.clientId).toBe("wertheinagro.com");
    expect(s.strength).toBe(3);
  });

  it("dominio compartido vinculado y mail citado del cliente", () => {
    const shared = suggestFor([werthein, other], "ana@acsistec.com.ar", "Consulta", "texto sin pistas", "texto");
    expect(shared.map((s) => s.clientId)).toEqual(["wertheinagro.com"]);
    const quoted = suggestFor([werthein, other], "x@otro.com", "RE: algo", "> De: pepe@glam.com.ar escribió…", "ok");
    expect(quoted[0].clientId).toBe("glam.com.ar");
  });

  it("palabras genéricas de razón social no alcanzan", () => {
    expect(suggestFor([other], "x@otro.com", "Distribuciones del mes", "nada", "nada")).toHaveLength(0);
  });
});
