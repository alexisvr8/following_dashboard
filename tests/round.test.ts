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
