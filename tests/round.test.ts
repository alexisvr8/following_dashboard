import { describe, expect, it } from "vitest";
import { roundOf, type PlannedItem } from "@/lib/utils/deadlines";
import { groupOf, isOlder } from "@/components/accionables/format";

const WORK = [1, 2, 3, 4, 5];
// Jueves 26/11/2026.
const now = new Date("2026-11-26T15:00:00");

describe("roundOf (De esta semana / Para cerrar)", () => {
  it("cuenta los últimos 5 días hábiles, incluido hoy", () => {
    expect(roundOf("2026-11-26T10:00:00", false, now, WORK)).toBe("current"); // hoy
    expect(roundOf("2026-11-20T10:00:00", false, now, WORK)).toBe("current"); // viernes pasado (4 háb. atrás)
    expect(roundOf("2026-11-21T10:00:00", false, now, WORK)).toBe("current"); // sábado
    expect(roundOf("2026-11-19T10:00:00", false, now, WORK)).toBe("backlog"); // jueves pasado (5 háb.)
  });
  it("lo arrastrado de una minuta anterior siempre es para cerrar", () => {
    expect(roundOf("2026-11-25T10:00:00", true, now, WORK)).toBe("backlog");
  });
});

describe("grupos del tablero por ronda", () => {
  const item = (p: Partial<PlannedItem>) => ({ carried: false, round: "current", ...p }) as PlannedItem;
  it("lo viejo sin minuta nueva deja de ser 'Nuevo'", () => {
    expect(groupOf(item({ round: "backlog" }))).toBe("carried");
    expect(isOlder(item({ round: "backlog" }))).toBe(true);
    expect(groupOf(item({}))).toBe("fresh");
  });
});

describe("sin fecha dicha en la reunión → semana siguiente", () => {
  it("'lo antes posible' cae en la semana de la reunión", async () => {
    const { parseDue } = await import("@/lib/utils/gemini-notes-parser");
    const tue = "2026-11-24T10:00:00";
    expect(parseDue("Enviar el archivo lo antes posible", tue, WORK)?.until.getDate()).toBe(27); // viernes
    expect(parseDue("Revisarlo cuanto antes", "2026-11-27T10:00:00", WORK)?.until.getDate()).toBe(30); // viernes → lunes
  });
  it("paso de minuta sin fecha → viernes de la semana siguiente; con 'mañana' → mañana", async () => {
    const { plannedItems } = await import("@/lib/utils/deadlines");
    const client = {
      id: "c1",
      name: "Cliente",
      status: "assigned",
      profile: {},
      meetings: [
        {
          id: "m1",
          title: "Reunión",
          date: "2026-11-24T10:00:00",
          nextSteps: ["[Alexis Vásquez R] Revisar endpoints: faltantes del ERP", "[Alexis Vásquez R] Pasar credenciales mañana"],
        },
      ],
    } as never;
    const settings = { workDays: WORK, hoursPerActionable: 0.5, ownerAliases: ["Alexis Vásquez R"] } as never;
    const items = plannedItems([client], settings, new Date("2026-11-24T15:00:00"));
    const byTitle = (t: string) => items.find((i) => i.fullText.includes(t))!;
    expect(new Date(byTitle("endpoints").due).getDate()).toBe(4); // vie 04/12
    expect(byTitle("endpoints").nextWeekTarget).toBe(true);
    expect(byTitle("endpoints").bucket).toBe("next_week");
    expect(new Date(byTitle("credenciales").due).getDate()).toBe(25);
  });
});
