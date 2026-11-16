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
  it("vencido → preparar la reunión más cercana → más atención → resto por fecha", () => {
    const sorted = [
      item("resto-pronto", { due: "2026-11-16T23:59:59.000Z", bucket: "today" }),
      item("atencion", { attention: true, due: "2026-11-19T23:59:59.000Z" }),
      item("prep-jueves", { prep: true, meetingSoonAt: "2026-11-19T13:00:00.000Z", due: "2026-11-25T23:59:59.000Z" }),
      item("prep-martes", { prep: true, meetingSoonAt: "2026-11-17T13:00:00.000Z", due: "2026-11-25T23:59:59.000Z" }),
      item("vencido", { bucket: "overdue", due: "2026-11-13T23:59:59.000Z" }),
    ].sort(compareItems);
    expect(sorted.map((i) => i.id)).toEqual(["vencido", "prep-martes", "prep-jueves", "atencion", "resto-pronto"]);
  });
});

describe("boardGroups con reunión próxima", () => {
  it("atención → reunión próxima (la más cercana primero) → arrastrados → nuevos", () => {
    const g = boardGroups([
      item("nuevo", {}),
      item("arrastrado", { carried: true }),
      item("reunion-jue", { meetingSoonAt: "2026-11-19T13:00:00.000Z", carried: true }),
      item("reunion-mar", { meetingSoonAt: "2026-11-17T13:00:00.000Z", side: "me_deben" }),
      item("atencion", { attention: true, meetingSoonAt: "2026-11-17T13:00:00.000Z" }),
    ]);
    expect(g.attention.map((i) => i.id)).toEqual(["atencion"]);
    expect(g.meeting.map((i) => i.id)).toEqual(["reunion-mar", "reunion-jue"]);
    expect(g.carried.map((i) => i.id)).toEqual(["arrastrado"]);
    expect(g.fresh.map((i) => i.id)).toEqual(["nuevo"]);
  });
});
