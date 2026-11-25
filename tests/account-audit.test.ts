import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { DEFAULT_SETTINGS } from "@/lib/store/settings-store";
import type { AccountAuditOutput, AuditVerdict } from "@/lib/llm/account-audit-schema";
import { auditBoard, auditView, ddmmNear } from "@/lib/utils/account-audit";

const NOW = new Date("2026-11-25T09:00:00-03:00");
const DAY = 86_400_000;
const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"] };

const meeting: DiscoveredMeeting = {
  id: "m1",
  docId: null,
  title: "Seguimiento",
  date: new Date(NOW.getTime() - 3 * DAY).toISOString(),
  summary: null,
  nextSteps: ["[Ana Pérez] Enviar accesos", "[Alexis Vásquez R] Configurar mapeo", "[Alexis Vásquez R] Configurar el mapeo de campos"],
};

const base = (): ClientRecord => ({
  id: "acme.com",
  domain: "acme.com",
  name: "Acme",
  status: "assigned",
  contactEmails: ["ana@acme.com"],
  meetings: [meeting],
  trackingStatus: null,
});

const verdict = (ref: string, over: Partial<AuditVerdict> = {}): AuditVerdict => ({
  ref,
  veredicto: "vigente",
  duplicado_de: null,
  fecha_hecho: null,
  lado: "debo",
  responsable: "",
  reescritura: null,
  fecha_acordada: null,
  confianza: "alta",
  evidencia: "«…» (Reunión 22/11)",
  motivo: "",
  ...over,
});

function withAudit(client: ClientRecord, accionables: (refs: Record<string, string>) => AuditVerdict[], extra: Partial<AccountAuditOutput> = {}): ClientRecord {
  const { refs, texts, items } = auditBoard(client, settings, NOW, null);
  const byText = (t: string) => Object.keys(refs).find((r) => texts[r].includes(t))!;
  void items;
  const out: AccountAuditOutput = {
    cuenta: {
      resumen: "r",
      etapa: "",
      erp: { valor: null, evidencia: "" },
      desarrollo: { quien: "no_claro", detalle: "", confianza: "baja", evidencia: "" },
      rol_pm: "no_claro",
      proximo_paso: "",
    },
    contactos: [],
    accionables: accionables(Object.fromEntries(["Enviar accesos", "Configurar mapeo", "mapeo de campos"].map((t) => [t, byText(t)]))),
    faltantes: [],
    preguntas: [],
    ...extra,
  };
  return { ...client, audit: { generatedAt: NOW.toISOString(), model: "test", refs, refTexts: texts, output: out, meetingsRead: 1, threadsRead: 0, partnerThreadsRead: 0 } };
}

describe("ddmmNear", () => {
  it("elige el año más cercano a la referencia", () => {
    expect(ddmmNear("28/11", NOW)).toBe("2026-11-28");
    expect(ddmmNear("05/01", NOW)).toBe("2027-01-05");
    expect(ddmmNear("20/10", NOW)).toBe("2026-10-20");
    expect(ddmmNear(null, NOW)).toBeNull();
  });
});

describe("auditView", () => {
  it("convierte veredictos en propuestas y omite los vigentes sin cambios", () => {
    const c = withAudit(base(), (r) => [
      verdict(r["Enviar accesos"], { veredicto: "hecho", fecha_hecho: "24/11", lado: "me_deben" }),
      verdict(r["Configurar mapeo"], { veredicto: "duplicado", duplicado_de: r["mapeo de campos"] }),
      verdict(r["mapeo de campos"]),
    ]);
    const v = auditView(c, settings, NOW)!;
    expect(v.unchanged).toBe(1);
    const kinds = v.proposals.map((p) => p.kind).sort();
    expect(kinds).toEqual(["done", "remove"]);
    expect(v.proposals.find((p) => p.kind === "done")!.apply?.doneAt).toBe("2026-11-24");
  });

  it("propone cambio de lado y reescritura conservando el responsable", () => {
    const c = withAudit(base(), (r) => [
      verdict(r["Enviar accesos"], { lado: "me_deben" }),
      verdict(r["Configurar mapeo"], { lado: "me_deben", responsable: "Renzo Ramirez", reescritura: { titulo: "Configurar mapeo", descripcion: "Mapear campos del conector" } }),
      verdict(r["mapeo de campos"]),
    ]);
    const v = auditView(c, settings, NOW)!;
    const side = v.proposals.filter((p) => p.kind === "side");
    expect(side).toHaveLength(1);
    expect(side[0].apply?.side).toBe("me_deben");
    expect(v.proposals.find((p) => p.kind === "edit")!.apply?.title).toBe("[Renzo Ramirez] Configurar mapeo: Mapear campos del conector");
  });

  it("deja de proponer si el accionable cambió de texto, se cerró o ya se resolvió", () => {
    const c = withAudit(base(), (r) => [
      verdict(r["Enviar accesos"], { veredicto: "hecho" }),
      verdict(r["Configurar mapeo"], { veredicto: "no_corresponde" }),
      verdict(r["mapeo de campos"], { veredicto: "hecho" }),
    ]);
    const refs = c.audit!.refs;
    const accesos = Object.keys(refs).find((k) => c.audit!.refTexts[k].includes("Enviar accesos"))!;
    const mapeo = Object.keys(refs).find((k) => c.audit!.refTexts[k].includes("Configurar mapeo"))!;
    const campos = Object.keys(refs).find((k) => c.audit!.refTexts[k].includes("mapeo de campos"))!;
    const edited: ClientRecord = {
      ...c,
      actionableEdits: { [refs[accesos]]: "[Ana Pérez] Enviar accesos de producción" },
      doneTicketIds: [refs[mapeo]],
      audit: { ...c.audit!, resolved: { [`${campos}:done`]: { action: "dismissed", at: NOW.toISOString() } } },
    };
    expect(auditView(edited, settings, NOW)!.proposals).toEqual([]);
  });

  it("faltantes y preguntas", () => {
    const c = withAudit(base(), () => [], {
      faltantes: [{ titulo: "Enviar listado", descripcion: "Proveedores prioritarios", lado: "debo", responsable: "", fecha: "27/11", confianza: "media", evidencia: "x" }],
      preguntas: [{ tipo: "cuenta", ref: null, pregunta: "¿Quién desarrolla?", contexto: "y" }],
    });
    const v = auditView(c, settings, NOW)!;
    const add = v.proposals.find((p) => p.kind === "add")!;
    expect(add.apply).toEqual({ title: "[Alexis Vásquez R] Enviar listado: Proveedores prioritarios", side: "debo", due: "2026-11-27" });
    expect(v.proposals.some((p) => p.kind === "question")).toBe(true);
  });
});
