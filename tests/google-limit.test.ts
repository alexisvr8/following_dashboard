import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store/backend", () => ({ getState: async () => null, setState: async () => undefined }));
const { googlePausedUntil, noteGoogleLimit, noteGoogleOk } = await import("@/lib/integrations/google-limit");

const cut = (at: Date) => new Error(`User-rate limit exceeded.  Retry after ${at.toISOString()}`);
const MIN = 60_000;

describe("pausa de Gmail", () => {
  afterEach(() => vi.useRealTimers());

  it("respeta la hora de Google y escala si vuelve a cortar apenas termina", () => {
    vi.useFakeTimers();
    const t0 = new Date(2026, 10, 27, 10, 0);
    vi.setSystemTime(t0);
    expect(noteGoogleLimit(cut(new Date(t0.getTime() + 15 * MIN)))?.getTime()).toBe(t0.getTime() + 15 * MIN);
    expect(googlePausedUntil()).not.toBeNull();
    // Durante la pausa, otro error no la cambia.
    noteGoogleLimit(cut(new Date(t0.getTime() + 5 * MIN)));
    expect(Date.parse(googlePausedUntil()!)).toBe(t0.getTime() + 15 * MIN);
    // Termina, se prueba y Google corta de nuevo: 30 min, después 60.
    const t1 = t0.getTime() + 16 * MIN;
    vi.setSystemTime(t1);
    expect(googlePausedUntil()).toBeNull();
    expect(noteGoogleLimit(cut(new Date(t1 + 15 * MIN)))?.getTime()).toBe(t1 + 30 * MIN);
    const t2 = t1 + 31 * MIN;
    vi.setSystemTime(t2);
    expect(noteGoogleLimit(cut(new Date(t2 + 15 * MIN)))?.getTime()).toBe(t2 + 60 * MIN);
    // Anduvo una llamada: se olvida la escalada.
    vi.setSystemTime(t2 + 61 * MIN);
    noteGoogleOk();
    const t3 = t2 + 62 * MIN;
    vi.setSystemTime(t3);
    expect(noteGoogleLimit(cut(new Date(t3 + 15 * MIN)))?.getTime()).toBe(t3 + 15 * MIN);
  });
});
