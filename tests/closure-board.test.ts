import { describe, expect, it } from "vitest";
import type { ClientRecord } from "@/lib/store/clients-store";
import type { PlannedItem } from "@/lib/utils/deadlines";
import { meetingsAfterClosure } from "@/lib/utils/closure";
import { boardGroups, movedItem } from "@/components/accionables/format";

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

describe("boardGroups", () => {
  it("atención → arrastrados → nuevos, y dentro de cada grupo prioridad antes que fecha", () => {
    const g = boardGroups([
      item("nuevo-baja-pronto", { priority: "baja", due: "2026-11-16T23:59:59.000Z" }),
      item("nuevo-alta-tarde", { priority: "alta", due: "2026-11-20T23:59:59.000Z" }),
      item("arrastrado", { carried: true }),
      item("atencion-arrastrado", { attention: true, carried: true }),
    ]);
    expect(g.attention.map((i) => i.id)).toEqual(["atencion-arrastrado"]);
    expect(g.carried.map((i) => i.id)).toEqual(["arrastrado"]);
    expect(g.fresh.map((i) => i.id)).toEqual(["nuevo-alta-tarde", "nuevo-baja-pronto"]);
  });
});

describe("movedItem", () => {
  it("pone la fecha manual y la columna nueva al instante", () => {
    const now = new Date(2026, 10, 16, 10); // lunes
    const m = movedItem(item("a", { bucket: "overdue", dueKind: "target" }), "this_week", "2026-11-20", now, [1, 2, 3, 4, 5]);
    expect(m.bucket).toBe("this_week");
    expect(m.dueKind).toBe("manual");
    expect(m.businessDaysLeft).toBe(4);
  });
});

describe("meetingsAfterClosure", () => {
  const client = (status: ClientRecord["status"]) =>
    ({
      status,
      profile: { closure: { at: "2026-11-10T15:00:00.000Z", handedTo: "Soporte" } },
      meetings: [
        { id: "n", date: "2026-11-12T14:00:00.000Z", title: "Nueva" },
        { id: "v", date: "2026-11-05T14:00:00.000Z", title: "Vieja" },
      ],
    }) as unknown as ClientRecord;

  it("solo las reuniones posteriores al cierre de una cuenta cerrada", () => {
    expect(meetingsAfterClosure(client("closed")).map((m) => m.id)).toEqual(["n"]);
    expect(meetingsAfterClosure(client("assigned"))).toEqual([]);
  });
});
