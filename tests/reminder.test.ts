import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { followupKey } from "@/lib/store/clients-store";
import { DEFAULT_SETTINGS } from "@/lib/store/settings-store";
import { buildReminder, reminderSteps } from "@/lib/utils/followup";
import { stepTicketId } from "@/lib/utils/actionables";

const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"] };
const meeting: DiscoveredMeeting = {
  id: "m1",
  docId: null,
  title: "Reunión m1",
  date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  summary: null,
  nextSteps: ["[Ana Pérez] Enviar accesos al ERP", "[Alexis Vásquez R] Configurar mapeo", "[Juan Gómez] Validar listado de proveedores"],
  attendees: [
    { email: "ana.perez@acme.com", name: "Ana Pérez" },
    { email: "juan.gomez@acme.com", name: "Juan Gómez" },
  ],
} as DiscoveredMeeting;
const client: ClientRecord = {
  id: "acme.com",
  domain: "acme.com",
  name: "Acme",
  status: "assigned",
  contactEmails: ["ana.perez@acme.com", "juan.gomez@acme.com"],
  meetings: [meeting],
  trackingStatus: null,
};

describe("buildReminder", () => {
  it("lista solo lo que tiene el cliente, corto y pidiendo status", () => {
    expect(reminderSteps(client, "alexis@xtract.com", settings)).toHaveLength(2);
    const d = buildReminder(client, meeting, "alexis@xtract.com", settings);
    expect(d.body).toContain("Enviar accesos al ERP (Ana)");
    expect(d.body).toContain("Validar listado de proveedores (Juan)");
    expect(d.body).not.toContain("Configurar mapeo");
    expect(d.body).toMatch(/cómo vienen/);
    expect(d.ticketId).toBeUndefined();
  });
  it("un solo punto: va dirigido a su responsable", () => {
    const id = stepTicketId(client.id, meeting.id, 2);
    const d = buildReminder(client, meeting, "alexis@xtract.com", settings, id);
    expect(d.ticketId).toBe(id);
    expect(d.to).toEqual(["juan.gomez@acme.com"]);
    expect(d.body.startsWith("Hola Juan,")).toBe(true);
    expect(d.body).toContain("• Validar listado de proveedores");
    expect(d.body).not.toContain("Enviar accesos");
    expect(followupKey("reminder", meeting.id, id)).toBe(`reminder:item:${id}`);
  });
});
