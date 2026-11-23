import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { minutaAlreadySent } from "@/lib/integrations/meeting-ai";
import { followupKey } from "@/lib/store/clients-store";

const meeting = { id: "m1", docId: "d1", title: "R", date: "2026-11-19T14:00:00.000Z", durationMinutes: 60, summary: null, nextSteps: [] } as unknown as DiscoveredMeeting;
const client = (mails: { direction: string; date: string }[], extra: Partial<ClientRecord> = {}) =>
  ({ id: "acme.com", name: "Acme", status: "assigned", meetings: [meeting], activity: { recentMails: mails }, ...extra }) as unknown as ClientRecord;

describe("minutaAlreadySent (no gastar IA si la minuta ya salió)", () => {
  it("mail mío después del fin de la reunión → ya enviada", () => {
    expect(minutaAlreadySent(client([{ direction: "me", date: "2026-11-19T16:00:00.000Z" }]), meeting)).toBe(true);
  });
  it("sin mail mío posterior (o solo del cliente) → falta", () => {
    expect(minutaAlreadySent(client([{ direction: "client", date: "2026-11-19T16:00:00.000Z" }]), meeting)).toBe(false);
    expect(minutaAlreadySent(client([{ direction: "me", date: "2026-11-19T14:30:00.000Z" }]), meeting)).toBe(false);
  });
  it("enviada desde la app → ya enviada", () => {
    expect(minutaAlreadySent(client([], { followups: { [followupKey("meeting", "m1")]: { sentAt: "2026-11-19T17:00:00.000Z" } } } as never), meeting)).toBe(true);
  });
});
