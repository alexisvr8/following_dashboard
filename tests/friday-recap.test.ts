import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { DEFAULT_SETTINGS } from "@/lib/store/settings-store";
import { buildFridayRecap, buildMondayNudge } from "@/lib/utils/followup";
import { stepTicketId } from "@/lib/utils/actionables";
import { minutaChanges } from "@/lib/utils/minuta-review";

const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"] };
const friday = new Date(2026, 10, 27, 11, 0); // viernes 27/11
const meeting: DiscoveredMeeting = {
  id: "m1",
  docId: null,
  title: "Reunión m1",
  date: new Date(2026, 10, 24, 10).toISOString(), // martes de esta semana
  summary: null,
  nextSteps: ["[Ana Pérez] Enviar accesos al ERP", "[Alexis Vásquez R] Configurar mapeo", "[Alexis Vásquez R] Revisar plan de cuentas"],
  attendees: [
    { email: "ana.perez@acme.com", name: "Ana Pérez" },
    { email: "juan.gomez@acme.com", name: "Juan Gómez" },
  ],
} as DiscoveredMeeting;
const doneId = stepTicketId("acme.com", "m1", 2);
const client = {
  id: "acme.com",
  domain: "acme.com",
  name: "Acme",
  status: "assigned",
  contactEmails: ["ana.perez@acme.com", "juan.gomez@acme.com"],
  meetings: [meeting],
  trackingStatus: null,
  doneTicketIds: [doneId],
  doneTicketAt: { [doneId]: new Date(2026, 10, 25, 15).toISOString() },
} as unknown as ClientRecord;

describe("resumen del viernes", () => {
  const d = buildFridayRecap(client, meeting, "alexis@xtract.com", settings, friday)!;

  it("lo cerrado en la semana + lo abierto por lado, con líneas validables", () => {
    expect(d.body).toContain("✅ Ya avanzamos con:");
    expect(d.body).toContain("Revisar plan de cuentas. (Alexis) - Status: Hecho ✅ (25/11)");
    expect(d.body).toContain("De parte de Acme:");
    expect(d.body).toContain("Enviar accesos al ERP");
    expect(d.body).toContain("De nuestro lado (Xtract):");
    expect(d.body.trim().endsWith("Saludos")).toBe(true);
    // Sin tocar nada no hay cambios que validar; sacar el punto del cliente = "removed".
    expect(minutaChanges(d.minutaItems!, d.body)).toEqual([]);
    const sinAna = d.body.split("\n").filter((l) => !l.includes("Enviar accesos")).join("\n");
    expect(minutaChanges(d.minutaItems!, sinAna).map((c) => [c.kind, c.ticketId])).toEqual([["removed", stepTicketId("acme.com", "m1", 0)]]);
  });

  it("semana sin movimiento: no hay resumen", () => {
    const quiet = { ...client, doneTicketIds: [], doneTicketAt: {}, meetings: [{ ...meeting, date: new Date(2026, 10, 10, 10).toISOString() }] } as unknown as ClientRecord;
    expect(buildFridayRecap(quiet, quiet.meetings[0], "alexis@xtract.com", settings, friday)).toBeNull();
  });

  it("el lunes: recordatorio corto en el hilo del viernes, con la reunión solo si hay", () => {
    const monday = new Date(2026, 10, 30, 8, 30);
    const sent = { ...d, threadId: "t1", subject: "Seguimiento Acme" };
    const withMeeting = buildMondayNudge(client, meeting, sent, new Date(2026, 11, 3, 15).toISOString(), "alexis@xtract.com", settings, monday)!;
    expect(withMeeting.mondayNudge).toBe(true);
    expect(withMeeting.threadId).toBe("t1");
    expect(withMeeting.subject).toBe("Re: Seguimiento Acme");
    expect(withMeeting.body).toContain("viernes");
    expect(withMeeting.body).toContain("de cara a nuestra reunión pautada para el jueves 03/12");
    expect(withMeeting.body).not.toContain("Enviar accesos");
    const without = buildMondayNudge(client, meeting, sent, null, "alexis@xtract.com", settings, monday)!;
    expect(without.body).not.toContain("reunión");
  });
});
