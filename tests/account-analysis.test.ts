import { describe, expect, it } from "vitest";
import type { ClientRecord, DiscoveredMeeting } from "@/lib/store/clients-store";
import { DEFAULT_SETTINGS } from "@/lib/store/settings-store";
import type { AccountAnalysisOutput } from "@/lib/llm/account-analysis-schema";
import { analysisWindow, buildAnalysisInput, newItemsFromAnalysis, pendingRewrites, sanitizeRefs } from "@/lib/utils/account-analysis";
import { accountActionables, stepTicketId } from "@/lib/utils/actionables";
import { nextMeetings } from "@/lib/utils/deadlines";

const NOW = new Date("2026-11-16T07:00:00-03:00");
const DAY = 86_400_000;
const settings = { ...DEFAULT_SETTINGS, ownerAliases: ["Alexis Vásquez R"] };

const meeting = (id: string, daysAgo: number, nextSteps: string[]): DiscoveredMeeting => ({
  id,
  docId: null,
  title: `Reunión ${id}`,
  date: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  summary: null,
  nextSteps,
});

const client = (over: Partial<ClientRecord> = {}): ClientRecord => ({
  id: "acme.com",
  domain: "acme.com",
  name: "Acme",
  status: "assigned",
  contactEmails: ["ana@acme.com"],
  meetings: [meeting("m1", 3, ["[Ana Pérez] Enviar accesos", "[Alexis Vásquez R] Configurar mapeo"])],
  trackingStatus: null,
  ...over,
});

const output = (over: Partial<AccountAnalysisOutput> = {}): AccountAnalysisOutput => ({
  estado: "avanzando",
  resumen: "",
  ultima_interaccion: { tipo: "reunion", fecha: "13/11", resumen: "" },
  prioridad: { nivel: "media", engagement: "media", complejidad: "media", motivo: "" },
  conversaciones: [],
  accionables_semana: [],
  posibles_resueltos: [],
  reescrituras: [],
  riesgos: [],
  proximo_mail: "",
  revision: [],
  ...over,
});

describe("analysisWindow", () => {
  it("reunión ≤7 días → base reunión, mails desde al menos 14 días", () => {
    const w = analysisWindow(client(), NOW);
    expect(w.basis).toBe("reunion");
    expect(NOW.getTime() - w.since.getTime()).toBeGreaterThanOrEqual(14 * DAY);
  });
  it("reunión vieja → base mails, entre 21 y 45 días", () => {
    const w = analysisWindow(client({ meetings: [meeting("m1", 90, [])] }), NOW);
    expect(w.basis).toBe("mails");
    expect(NOW.getTime() - w.since.getTime()).toBe(45 * DAY);
    const w2 = analysisWindow(client({ meetings: [meeting("m1", 10, [])] }), NOW);
    expect(NOW.getTime() - w2.since.getTime()).toBe(21 * DAY);
  });
});

describe("refs y salida", () => {
  it("numera los abiertos, guarda su texto y marca reescribibles", () => {
    const { refs, refTexts, rewritable } = buildAnalysisInput(client(), settings, [], NOW, null);
    const ids = Object.values(refs);
    expect(ids).toContain(stepTicketId("acme.com", "m1", 0));
    const ref = Object.keys(refs).find((r) => refs[r] === stepTicketId("acme.com", "m1", 0))!;
    expect(refTexts[ref]).toBe("[Ana Pérez] Enviar accesos");
    expect(rewritable).toContain(ref);
  });

  it("descarta refs inventadas y reescrituras de refs no reescribibles", () => {
    const out = sanitizeRefs(
      output({
        accionables_semana: [
          { ref: "A99", titulo: "X", descripcion: "", lado: "debo", responsable: "", prioridad: "media", fecha: null, evidencia: "", minutos_estimados: 0 },
        ],
        posibles_resueltos: [{ ref: "A99", evidencia: "" }],
        reescrituras: [
          { ref: "A1", titulo: "Ok", descripcion: "", responsable: "", motivo: "" },
          { ref: "A2", titulo: "No", descripcion: "", responsable: "", motivo: "" },
        ],
      }),
      { A1: "t1", A2: "t2" },
      ["A1"],
    );
    expect(out.accionables_semana[0].ref).toBeNull();
    expect(out.posibles_resueltos).toHaveLength(0);
    expect(out.reescrituras.map((r) => r.ref)).toEqual(["A1"]);
  });

  it("nuevos: dueño por defecto = yo si es debo; fecha solo si vino", () => {
    const items = newItemsFromAnalysis(
      output({
        accionables_semana: [
          { ref: null, titulo: "Revisar factura", descripcion: "La 123", lado: "debo", responsable: "", prioridad: "alta", fecha: null, evidencia: "Mail", minutos_estimados: 47 },
          { ref: null, titulo: "Pasar CUIT", descripcion: "", lado: "me_deben", responsable: "", prioridad: "media", fecha: "20/11", evidencia: "Mail", minutos_estimados: 0 },
        ],
      }),
      settings,
      new Date("2026-11-01T00:00:00-03:00"),
    );
    expect(items[0].text).toBe("[Alexis Vásquez R] Revisar factura: La 123");
    expect(items[0].due).toBeNull();
    expect(items[1].text).toBe("Pasar CUIT");
    expect(items[1].due).toBe("2026-11-20");
    expect(items[0].minutes).toBe(45);
    expect(items[1].minutes).toBe(0);
  });
});

describe("pendingRewrites", () => {
  const withAnalysis = (over: Partial<ClientRecord> = {}) => {
    const c = client(over);
    const t0 = stepTicketId("acme.com", "m1", 0);
    c.analysis = {
      week: "2026-11-16",
      generatedAt: NOW.toISOString(),
      model: "x",
      basis: "reunion",
      since: NOW.toISOString(),
      threadsRead: 0,
      mailsRead: 0,
      refs: { A1: t0 },
      refTexts: { A1: "[Ana Pérez] Enviar accesos" },
      addedTicketIds: [],
      output: output({
        reescrituras: [{ ref: "A1", titulo: "Enviar accesos productivo", descripcion: "Usuario de solo lectura en Finnegans", responsable: "", motivo: "Vago" }],
      }),
    };
    return c;
  };

  it("propone conservando el dueño actual si la IA no da responsable", () => {
    const [r] = pendingRewrites([withAnalysis()]);
    expect(r.proposed).toBe("[Ana Pérez] Enviar accesos productivo: Usuario de solo lectura en Finnegans");
    expect(r.current).toBe("[Ana Pérez] Enviar accesos");
  });

  it("no ofrece si el accionable cambió, se cerró o ya se resolvió", () => {
    const t0 = stepTicketId("acme.com", "m1", 0);
    expect(pendingRewrites([withAnalysis({ actionableEdits: { [t0]: "otro texto" } })])).toHaveLength(0);
    expect(pendingRewrites([withAnalysis({ doneTicketIds: [t0] })])).toHaveLength(0);
    const c = withAnalysis();
    c.analysis!.rewritesResolved = { A1: "dismissed" };
    expect(pendingRewrites([c])).toHaveLength(0);
  });
});

describe("arrastre de lo agregado por la IA", () => {
  it("es arrastrado solo si llegó una reunión después de detectarlo", () => {
    const ia = { id: "acme.com:custom-ia-1", title: "Algo", meetingId: "m1", createdAt: new Date(NOW.getTime() - 2 * DAY).toISOString(), source: "ia" as const };
    const fresh = accountActionables(client({ customActionables: [ia] })).find((a) => a.id === ia.id)!;
    expect(fresh.carried).toBe(false);
    const later = client({ customActionables: [ia], meetings: [meeting("m1", 3, []), meeting("m2", 1, [])] });
    expect(accountActionables(later).find((a) => a.id === ia.id)!.carried).toBe(true);
  });
});

describe("nextMeetings", () => {
  it("una cuenta ignorada con invitados en común no se queda con la reunión", () => {
    const partner = client({ id: "softcrates.com", domain: "softcrates.com", name: "Softcrates", status: "ignored", contactEmails: [] });
    const acme = client();
    const event = {
      id: "e",
      title: "Acme + Xtract",
      start: new Date(NOW.getTime() + 3 * DAY).toISOString(),
      end: new Date(NOW.getTime() + 3 * DAY + 3_600_000).toISOString(),
      minutes: 60,
      attendees: ["nico@softcrates.com", "ana@acme.com"],
    };
    expect(nextMeetings([partner, acme], [event], NOW).get("acme.com")).toBe(event.start);
  });
});

describe("meetingHasTicketState", () => {
  it("el follow-up sintético auto-tildado no cuenta como accionable tocado", async () => {
    const { meetingHasTicketState, followupTicketId } = await import("@/lib/store/clients-store");
    const c = client({ doneTicketIds: [followupTicketId("acme.com", "m1")] });
    expect(meetingHasTicketState(c, "m1")).toBe(false);
    c.doneTicketIds!.push(stepTicketId("acme.com", "m1", 1));
    expect(meetingHasTicketState(c, "m1")).toBe(true);
  });
});

describe("Más atención", () => {
  it("prioridad alta, meta interna de 1 día hábil y primero a igual fecha", async () => {
    const { plannedItems } = await import("@/lib/utils/deadlines");
    const normal = client({ id: "b.com", domain: "b.com", name: "B", contactEmails: [] });
    const vip = client({ profile: { attention: true } });
    const items = plannedItems([normal, vip], settings, NOW);
    const v = items.filter((i) => i.clientId === "acme.com");
    const step = (id: string) => items.find((i) => i.id === stepTicketId(id, "m1", 0))!;
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((i) => i.priority === "alta" && i.attention)).toBe(true);
    expect(step("acme.com").due < step("b.com").due).toBe(true);
    // A igual fecha (p. ej. el follow-up de 1 día de ambas), la de más atención va primero.
    expect(items[0].clientId).toBe("acme.com");
  });
});

describe("mail de seguimiento con IA", () => {
  it("usa la redacción de la IA solo con la huella vigente y mantiene el estado de la app", async () => {
    const { buildStatusUpdate, statusAIRequest } = await import("@/lib/utils/followup");
    const t0 = stepTicketId("acme.com", "m1", 0);
    const c = client({ doneTicketIds: [t0], doneTicketAt: { [t0]: new Date(NOW.getTime() - DAY).toISOString() } });
    const m = c.meetings[0];
    const req = statusAIRequest(c, m, "alexis@xtract.app", settings);
    const refs = req.input.sections.flatMap((s) => s.items.map((i) => i.ref));
    expect(refs.length).toBeGreaterThan(0);
    c.statusAI = {
      meetingId: m.id,
      key: req.key,
      generatedAt: NOW.toISOString(),
      model: "x",
      apertura: "APERTURA IA",
      items: Object.fromEntries(refs.map((r) => [r, `TEXTO ${r}`])),
      cierre: "CIERRE IA",
      revision: [],
    };
    const body = buildStatusUpdate(c, m, "alexis@xtract.app", settings).body;
    expect(body).toContain("APERTURA IA");
    expect(body).toContain("CIERRE IA");
    expect(body).toMatch(/TEXTO H1.*Status: Hecho/);
    expect(body).toMatch(/TEXTO .*Status: Pendiente/);
    // Si cambia lo tildado, la huella cambia y vuelve a reglas.
    c.doneTicketIds = [];
    expect(buildStatusUpdate(c, m, "alexis@xtract.app", settings).body).not.toContain("APERTURA IA");
  });
});

describe("resumen del lunes", () => {
  it("pone primero las cuentas foco (🔥) y deja el resto compacto", async () => {
    const { buildWeeklyDigest } = await import("@/lib/utils/weekly-digest");
    const vip = client({ id: "vip.com", domain: "vip.com", name: "Vip", contactEmails: [], profile: { attention: true } });
    const calm = client({ id: "calm.com", domain: "calm.com", name: "Calm", contactEmails: [], meetings: [meeting("m1", 1, [])] });
    const d = buildWeeklyDigest([calm, vip], settings, NOW, "http://localhost:3000");
    expect(d.body.indexOf("🔥 Vip")).toBeGreaterThan(-1);
    expect(d.body.indexOf("FOCO DE LA SEMANA")).toBeLessThan(d.body.indexOf("RESTO DE LAS CUENTAS"));
    expect(d.body).toContain("http://localhost:3000/cuentas/vip.com");
    expect(d.body).not.toMatch(/Calm[^\n]*\n\n?Debo:/);
  });
});

describe("estimación con IA", () => {
  it("manual > tus tiempos por tipo (mails fijo, el resto IA acotada) > default", async () => {
    const { plannedItems } = await import("@/lib/utils/deadlines");
    const t0 = stepTicketId("acme.com", "m1", 0); // "Enviar accesos" → mails
    const t1 = stepTicketId("acme.com", "m1", 1); // "Configurar mapeo" → configurar
    const t2 = stepTicketId("acme.com", "m1", 2); // "Parametrizar proveedores" → configurar
    const base = { meetings: [meeting("m1", 3, ["[Ana Pérez] Enviar accesos", "[Alexis Vásquez R] Configurar mapeo", "[Alexis Vásquez R] Parametrizar proveedores"])] };
    const g = { ...settings, estimateGuide: { comms: 15, review: 20, config: 45, build: 60 } };
    const items = plannedItems([client({ ...base, aiEstimate: { [t0]: 90, [t1]: 240, [t2]: 30 } })], g, NOW);
    const get = (id: string) => items.find((i) => i.id === id)!;
    expect([get(t0).estimateMinutes, get(t0).estimateSource]).toEqual([15, "guide"]);
    expect([get(t1).estimateMinutes, get(t1).estimateSource]).toEqual([70, "ai"]); // tope = 1,5 × 45
    expect(get(t2).estimateMinutes).toBe(35); // piso = 0,75 × 45
    const manual = plannedItems([client({ ...base, actionableEstimate: { [t1]: 120 } })], g, NOW);
    expect(manual.find((i) => i.id === t1)!.estimateSource).toBe("manual");
  });
});
