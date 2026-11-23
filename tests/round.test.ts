import { describe, expect, it } from "vitest";
import { roundOf, type PlannedItem } from "@/lib/utils/deadlines";
import { groupOf, isOlder } from "@/components/accionables/format";

const WORK = [1, 2, 3, 4, 5];
// Jueves 26/11/2026.
const now = new Date("2026-11-26T15:00:00");

describe("roundOf (Esta semana / Semana pasada)", () => {
  it("esta semana = origen esta semana o la anterior", () => {
    expect(roundOf("2026-11-26T10:00:00", null, now)).toBe("current"); // hoy
    expect(roundOf("2026-11-16T09:00:00", null, now)).toBe("current"); // lunes de la semana pasada
    expect(roundOf("2026-11-13T10:00:00", null, now)).toBe("backlog"); // hace 2 semanas
  });
  it("lo viejo con fecha acordada en esta semana vuelve a esta semana", () => {
    expect(roundOf("2026-11-10T10:00:00", new Date("2026-11-27T23:59:00"), now)).toBe("current");
    expect(roundOf("2026-11-10T10:00:00", new Date("2026-11-20T23:59:00"), now)).toBe("backlog"); // acordada y vencida
    expect(roundOf("2026-11-10T10:00:00", new Date("2026-12-02T23:59:00"), now)).toBe("backlog"); // acordada más adelante
  });
});

describe("grupos del tablero", () => {
  const item = (p: Partial<PlannedItem>) => ({ carried: false, round: "current", ...p }) as PlannedItem;
  it("solo Atención / Reunión próxima / Resto; la semana es un filtro", () => {
    expect(groupOf(item({ round: "backlog" }))).toBe("rest");
    expect(isOlder(item({ round: "backlog" }))).toBe(true);
    expect(groupOf(item({ attention: true }))).toBe("attention");
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

describe("columna Atrasados", () => {
  const item = (id: string, p: Partial<PlannedItem>) =>
    ({ id, carried: false, round: "current", bucket: "overdue", priority: "media", accountPriority: "media", side: "debo", originDate: "2026-11-10T10:00:00", due: "2026-11-20T23:59:00", ...p }) as PlannedItem;
  it("lo más viejo primero aunque tenga menos prioridad", async () => {
    const { boardGroups } = await import("@/components/accionables/format");
    const g = boardGroups([item("nuevo", { priority: "alta", originDate: "2026-11-17T10:00:00" }), item("viejo", { priority: "baja", originDate: "2026-11-03T10:00:00" })]);
    expect(g.rest.map((i) => i.id)).toEqual(["viejo", "nuevo"]);
  });
  it("el orden manual es por columna: al cambiar de columna cae arriba", async () => {
    const { boardGroups, orderKey } = await import("@/components/accionables/format");
    const a = item("a", { bucket: "this_week" });
    const b = item("b", { bucket: "overdue", due: "2026-11-27T23:59:00" });
    const c = item("c", {});
    const order = { [orderKey(c)]: 0, "this_week|b": 1 }; // b se ordenó cuando estaba en Esta semana
    expect(boardGroups([c, b], order).rest.map((i) => i.id)).toEqual(["b", "c"]);
    expect(orderKey(a)).toBe("this_week|a");
  });
});

describe("plazos: atrasados, corridos a hoy e IA", () => {
  const settings = { workDays: WORK, hoursPerActionable: 0.5, ownerAliases: ["Alexis Vásquez R"] } as never;
  const client = (meetings: { id: string; date: string; nextSteps: string[] }[], extra = {}) =>
    ({ id: "c1", name: "Cliente", status: "assigned", profile: {}, meetings: meetings.map((m) => ({ title: "Reunión", ...m })), ...extra }) as never;
  const run = async (c: never, at: string) => (await import("@/lib/utils/deadlines")).plannedItems([c], settings, new Date(at));

  it("lo abierto de antes de la última reunión va a Atrasados aunque su fecha no pasó", async () => {
    const items = await run(
      client([
        { id: "m1", date: "2026-11-17T10:00:00", nextSteps: ["[Alexis Vásquez R] Revisar endpoints"] },
        { id: "m2", date: "2026-11-23T10:00:00", nextSteps: ["[Alexis Vásquez R] Armar demo"] },
      ]),
      "2026-11-24T15:00:00",
    );
    const viejo = items.find((i) => i.fullText.includes("endpoints"))!;
    expect(viejo.bucket).toBe("overdue");
    expect(viejo.lateSince).toBe("2026-11-23T10:00:00");
    expect(items.find((i) => i.fullText.includes("demo"))!.bucket).toBe("next_week");
  });
  it("vencido dentro de esta semana → Hoy (slipped); de la semana pasada → Atrasados", async () => {
    const items = await run(
      client([{ id: "m1", date: "2026-11-17T10:00:00", nextSteps: ["[Alexis Vásquez R] Pasar credenciales el lunes", "[Alexis Vásquez R] Mandar archivo mañana"] }]),
      "2026-11-25T15:00:00",
    );
    const lunes = items.find((i) => i.fullText.includes("credenciales"))!; // venció lun 23
    expect(lunes.bucket).toBe("today");
    expect(lunes.slipped).toBe(true);
    expect(items.find((i) => i.fullText.includes("archivo"))!.bucket).toBe("overdue"); // venció mié 18
  });
  it("un dd/mm citado que corre de año no es fecha acordada", async () => {
    const items = await run(client([{ id: "m1", date: "2026-11-23T10:00:00", nextSteps: ["[Alexis Vásquez R] Analizar errores muestra 20/11"] }]), "2026-11-23T15:00:00");
    const it = items.find((i) => i.fullText.includes("muestra"))!;
    expect(it.dueKind).toBe("target");
    expect(it.bucket).toBe("next_week");
  });
});

describe("Hoy según los huecos de la agenda", () => {
  const client = (n: number) =>
    ({
      id: "c1",
      name: "Cliente",
      status: "assigned",
      profile: {},
      contactEmails: [],
      domain: "cliente.com",
      meetings: [{ id: "m1", title: "Reunión", date: "2026-11-17T10:00:00", nextSteps: Array.from({ length: n }, (_, k) => `[Alexis Vásquez R] Tarea ${k + 1}`) }],
    }) as never;
  const plan = async (n: number, skip: string[] = [], force: string[] = []) => {
    const { computeWeekPlan } = await import("@/lib/utils/week-plan");
    const { DEFAULT_SETTINGS } = await import("@/lib/store/settings-store");
    const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"], hoursPerActionable: 1, estimateGuide: { comms: 60, review: 60, config: 60, build: 60 } };
    return computeWeekPlan([client(n)], settings, [], 0, new Date("2026-11-24T08:00:00"), { skip: new Set(skip), force: new Set(force) }).items.filter((i) => i.kind === "step");
  };
  it("lo fijado para hoy ('+1 día' con reunión) entra aunque esté al final de la cola", async () => {
    const todos = await plan(12);
    const ultimo = todos.filter((i) => !i.plannedToday).at(-1)!.id;
    const items = await plan(12, [], [ultimo]);
    expect(items.find((i) => i.id === ultimo)!.bucket).toBe("today");
    expect(items.filter((i) => i.plannedToday).length).toBe(todos.filter((i) => i.plannedToday).length); // desplaza a otra
  });
  it("lo que saqué de Hoy no entra y su lugar lo toma el siguiente", async () => {
    const antes = (await plan(12)).filter((i) => i.plannedToday).map((i) => i.id);
    const despues = (await plan(12, [antes[0]])).filter((i) => i.plannedToday).map((i) => i.id);
    expect(despues).not.toContain(antes[0]);
    expect(despues.length).toBe(antes.length);
  });
  it("lo de esta semana que entra en el horario libre de hoy pasa a Hoy, el resto queda en Esta semana", async () => {
    const items = await plan(12);
    const hoy = items.filter((i) => i.plannedToday);
    expect(hoy.length).toBeGreaterThan(0);
    expect(hoy.length).toBeLessThan(12);
    expect(hoy.every((i) => i.bucket === "today")).toBe(true);
    expect(items.filter((i) => !i.plannedToday).every((i) => i.bucket === "this_week")).toBe(true);
  });
});
