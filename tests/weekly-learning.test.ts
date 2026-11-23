import { describe, expect, it } from "vitest";
import { ownMailText, parseMailItems } from "@/lib/utils/weekly-learning";

describe("parseMailItems", () => {
  it("lee los puntos del borrador (negrita) y de Gmail (cursiva, líneas cortadas)", () => {
    const draft = "Hola,\n\nIntro:\n\n1. **Verificar asiento (Joaquin):** Comparar el asiento. *(acordado para el vie 27/11)*\n2. **Definir cuentas:** Configurar cuentas.\n\nCierre.\nSaludos";
    const sent =
      "Buen día equipo.\n\n   1. *Verificar asiento de factura (Joaquin):* Comparar el asiento\n   resultante con la carga anterior.\n   2. *Respuesta Flexxus:* Necesitamos una respuesta.\n\nSaludos\nc5a3cec7\n*Alexis*\n\nEl lun, 16 nov 2026 a la(s) 11:03 a.m., X escribió:\n> 1. viejo";
    expect(parseMailItems(draft)).toMatchObject([
      { title: "Verificar asiento", owner: "Joaquin", detail: "Comparar el asiento." },
      { title: "Definir cuentas", owner: null },
    ]);
    expect(parseMailItems(sent).map((i) => i.title)).toEqual(["Verificar asiento de factura", "Respuesta Flexxus"]);
    expect(parseMailItems(sent)[0].detail).toBe("Comparar el asiento resultante con la carga anterior.");
  });

  it("corta la cita y la firma", () => {
    expect(ownMailText("Hola\n\nSaludos\nfirma\nEl lun, 1 nov 2026, X escribió:\n> cita")).toBe("Hola\n\nSaludos");
  });
});
