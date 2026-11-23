import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { DEFAULT_SETTINGS } from "@/lib/store/settings-store";
import { buildWeeklyPlan, weeklyAIRequest } from "@/lib/utils/followup";
import { stepTicketId } from "@/lib/utils/actionables";
import { bodyToHtml, bodyToPlain } from "@/lib/integrations/gmail";

const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"] };
const now = new Date(2026, 10, 23, 8, 30); // lunes 23/11
const meeting: DiscoveredMeeting = {
  id: "m1",
  docId: null,
  title: "Reunión m1",
  date: new Date(2026, 10, 18, 10).toISOString(),
  summary: null,
  nextSteps: ["[Ana Pérez] Enviar accesos al ERP", "[Alexis Vásquez R] Configurar mapeo", "[Alexis Vásquez R] Revisar plan de cuentas"],
  attendees: [
    { email: "ana.perez@acme.com", name: "Ana Pérez" },
    { email: "juan.gomez@acme.com", name: "Juan Gómez" },
  ],
} as DiscoveredMeeting;
const doneId = stepTicketId("acme.com", "m1", 2);
const client = (to: string[]): ClientRecord =>
  ({
    id: "acme.com",
    domain: "acme.com",
    name: "Acme",
    status: "assigned",
    contactEmails: to,
    meetings: [{ ...meeting, attendees: meeting.attendees!.filter((a) => to.includes(a.email)) }],
    trackingStatus: null,
    doneTicketIds: [doneId],
    // Cerrado el miércoles de la semana pasada (calendario), no "hace 7 días".
    doneTicketAt: { [doneId]: new Date(2026, 10, 18, 15).toISOString() },
  }) as ClientRecord;

describe("buildWeeklyPlan", () => {
  it("por reglas: tuteo con un solo destinatario y lo completado desde el lunes pasado", () => {
    const d = buildWeeklyPlan(client(["ana.perez@acme.com"]), meeting, "alexis@xtract.com", settings, now)!;
    expect(d.body).toContain("Te comparto los objetivos");
    expect(d.body).toContain("me avisas.");
    expect(d.body).toContain("Objetivos de tu lado");
    expect(d.body).toContain("✓ Revisar plan de cuentas");
  });

  it("con IA: estructura fija, lista numerada con negrita y solo lo del cliente", () => {
    const c = client(["ana.perez@acme.com", "juan.gomez@acme.com"]);
    const req = weeklyAIRequest(c, meeting, "alexis@xtract.com", settings, now)!;
    expect(req.input.plural).toBe(true);
    expect(req.input.clientItems.map((i) => i.text)).toEqual(["Enviar accesos al ERP"]);
    const out = {
        apertura: "Estoy avanzando con los puntos pendientes que quedaron de mi lado, de todas formas, necesito que avancemos con los puntos pendientes del lado de ustedes:",
        items: [{ ref: "P1", titulo: "Accesos al ERP", descripcion: "Usuario y clave del entorno de pruebas" }],
        cierre: "Apenas puedan darme el ok con estos puntos, genial para seguir avanzando.",
        revision: [],
    };
    const d = buildWeeklyPlan(c, meeting, "alexis@xtract.com", settings, now, { key: req.key, output: out })!;
    expect(d.body.split("\n")[0]).toMatch(/equipo/);
    // La semana siguiente el saludo cambia y la IA recibe el mail anterior para no repetirlo.
    const next = new Date(2026, 10, 30, 8, 30);
    const c2 = { ...c, followups: { "week:2026-11-23": { ...d, updatedAt: now.toISOString() } } } as ClientRecord;
    const req2 = weeklyAIRequest(c2, meeting, "alexis@xtract.com", settings, next)!;
    expect(req2.input.previousMails[0]).toContain("Accesos al ERP");
    expect(req2.input.angle.opening).not.toBe(req.input.angle.opening);
    expect(req2.input.tone).not.toBe(req.input.tone);
    const d2 = buildWeeklyPlan(c2, meeting, "alexis@xtract.com", settings, next, { key: req2.key, output: { ...out } })!;
    expect(d2.body.split("\n")[0]).not.toBe(d.body.split("\n")[0]);
    expect(d.body).toContain("1. **Accesos al ERP (Ana):** Usuario y clave del entorno de pruebas.");
    expect(d.body).not.toContain("Configurar mapeo");
    expect(d.body.trim().endsWith("Saludos")).toBe(true);
    const html = bodyToHtml(d.body);
    expect(html).toContain("<ol");
    expect(html).toContain("<strong>Accesos al ERP (Ana):</strong>");
    expect(html).not.toContain("<strong>Estoy avanzando");
    expect(bodyToHtml("1. **A:** b *(acordado para el viernes 27/11)*")).toContain("<em>(acordado para el viernes 27/11)</em>");
    expect(bodyToPlain(d.body)).toContain("1. Accesos al ERP (Ana): Usuario");
  });
});
