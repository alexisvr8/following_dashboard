import { describe, expect, it } from "vitest";
import { compareItems, type PlannedItem } from "@/lib/utils/deadlines";
import { boardGroups } from "@/components/accionables/format";

const item = (id: string, p: Partial<PlannedItem>): PlannedItem =>
  ({
    id,
    priority: "media",
    accountPriority: "media",
    side: "debo",
    due: "2026-11-18T23:59:59.000Z",
    originDate: "2026-11-10T12:00:00.000Z",
    carried: false,
    bucket: "this_week",
    ...p,
  }) as PlannedItem;

describe("compareItems (orden de Capacidad)", () => {
  it("vencido → preparar la reunión de hoy/mañana → cuenta en silencio → más atención → resto por fecha", () => {
    const sorted = [
      item("resto-pronto", { due: "2026-11-16T23:59:59.000Z", bucket: "today" }),
      item("atencion", { attention: true, due: "2026-11-19T23:59:59.000Z" }),
      item("silencio", { silent: true, due: "2026-11-20T23:59:59.000Z" }),
      // Reunión en 3+ días: ya no sube por preparación (queda por fecha).
      item("prep-lejana", { prep: true, meetingSoonAt: "2026-11-19T13:00:00.000Z", due: "2026-11-25T23:59:59.000Z" }),
      item("prep-mañana-tarde", { prep: true, prepUrgent: true, meetingSoonAt: "2026-11-17T18:00:00.000Z", due: "2026-11-25T23:59:59.000Z" }),
      item("prep-mañana", { prep: true, prepUrgent: true, meetingSoonAt: "2026-11-17T13:00:00.000Z", due: "2026-11-25T23:59:59.000Z" }),
      item("vencido", { bucket: "overdue", due: "2026-11-13T23:59:59.000Z" }),
    ].sort(compareItems);
    expect(sorted.map((i) => i.id)).toEqual([
      "vencido",
      "prep-mañana",
      "prep-mañana-tarde",
      "silencio",
      "atencion",
      "resto-pronto",
      "prep-lejana",
    ]);
  });
});

describe("boardGroups con reunión próxima", () => {
  it("atención → reunión próxima (la más cercana primero) → resto", () => {
    const g = boardGroups([
      item("nuevo", {}),
      item("arrastrado", { carried: true, round: "backlog" }),
      item("reunion-jue", { meetingSoonAt: "2026-11-19T13:00:00.000Z", carried: true }),
      item("reunion-mar", { meetingSoonAt: "2026-11-17T13:00:00.000Z", side: "me_deben" }),
      item("atencion", { attention: true, meetingSoonAt: "2026-11-17T13:00:00.000Z" }),
    ]);
    expect(g.attention.map((i) => i.id)).toEqual(["atencion"]);
    expect(g.meeting.map((i) => i.id)).toEqual(["reunion-mar", "reunion-jue"]);
    expect(g.rest.map((i) => i.id).sort()).toEqual(["arrastrado", "nuevo"]);
  });
});
