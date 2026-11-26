import { describe, expect, it } from "vitest";
import { actionableLine, renderPostMeetingMail } from "@/lib/utils/postmeeting-mail";
import { minutaChanges, parseMinutaLines, type MinutaItem } from "@/lib/utils/minuta-review";

const a1 = actionableLine("Enviar plan de cuentas: armar el Excel con las cuentas contables", "Denise", "Pendiente");
const a2 = actionableLine("Validar facturas de prueba: revisar las 5 facturas cargadas", "Denise", "Pendiente");
const a3 = actionableLine("Configurar el conector: dejar listo el acceso a Tango", "Alexis", "En curso");
const d1 = actionableLine("Alta de usuarios: crear los usuarios del equipo", "Alexis", "Hecho", "20/11");

const items: MinutaItem[] = [
  { ticketId: "c:m-0", line: a1, done: false },
  { ticketId: "c:m-1", line: a2, done: false },
  { ticketId: "c:m-2", line: a3, done: false },
  { ticketId: "c:m-3", line: d1, done: true },
];

const mail = (theirs: string[], ours: string[], done: string[]) =>
  renderPostMeetingMail({
    greeting: "Buenos días equipo,",
    thanks: "Gracias por la reunión de hoy. Les dejo el resumen:",
    puntos: ["Plan de cuentas"],
    objetivo: null,
    charlamos: ["**Tema:** algo que se charló con dos puntos: sí"],
    clientName: "Salvita",
    theirs,
    ours,
    done,
    extra: [],
    closing: "Cualquier cosa me avisan.",
  });

describe("minutaChanges", () => {
  it("sin cambios no propone nada", () => {
    expect(minutaChanges(items, mail([a1, a2], [a3], [d1]))).toEqual([]);
  });

  it("detecta lo sacado, lo pasado a Hecho y lo agregado", () => {
    const hecho = a3.replace("En curso ⏳", "Hecho ✅");
    const body = mail([a1, "• Pasar el contacto de sistemas: nombre y mail. (Denise) - Status: Pendiente ⏳"], [hecho], []);
    const changes = minutaChanges(items, body);
    expect(changes.map((c) => [c.kind, c.ticketId ?? c.title])).toEqual([
      ["removed", "c:m-1"],
      ["marked_done", "c:m-2"],
      ["added", "Pasar el contacto de sistemas"],
    ]);
  });

  it("mover un punto a 'Ya avanzamos con' cuenta como hecho; reescribirlo un poco no es sacarlo", () => {
    const edited = a1.replace("armar el Excel", "armar y mandar el Excel");
    const changes = minutaChanges(items, mail([edited], [], [d1, a2.replace("Pendiente ⏳", "Hecho ✅"), a3]));
    expect(changes.find((c) => c.ticketId === "c:m-0")).toBeUndefined();
    expect(changes.filter((c) => c.kind === "marked_done").map((c) => c.ticketId).sort()).toEqual(["c:m-1", "c:m-2"]);
  });

  it("lee el texto plano de Gmail (guiones, negritas con *, líneas cortadas)", () => {
    const plain = [
      "Buenos días equipo,",
      "",
      "🚀 Accionables:",
      "",
      "*De parte de Salvita:*",
      "   - *Enviar plan de cuentas:* armar el Excel con las cuentas",
      "   contables. (Denise) - *Status:* *Pendiente* ⏳",
      "",
      "*De nuestro lado (Xtract):*",
      "   - *Configurar el conector:* dejar listo el acceso a Tango. (Alexis) - *Status:* *Hecho* ✅",
      "",
      "Saludos",
      "",
      "El jue, 20 nov 2026 a las 10:00, Denise escribió:",
      "> • Validar facturas de prueba: ...",
    ].join("\n");
    const lines = parseMinutaLines(plain);
    expect(lines).toHaveLength(2);
    expect(lines[1].done).toBe(true);
    const changes = minutaChanges(items, plain);
    expect(changes.map((c) => [c.kind, c.ticketId])).toEqual([
      ["removed", "c:m-1"],
      ["marked_done", "c:m-2"],
    ]);
  });
});
