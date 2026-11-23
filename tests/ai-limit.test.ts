import { afterEach, describe, expect, it } from "vitest";
import { aiPausedUntil, isAILimitError, pauseAIFor } from "@/lib/llm/ai-limit";

const LIMIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}}';

describe("límite de gasto de la API", () => {
  afterEach(() => {
    globalThis.__aiPausedUntil = undefined;
  });
  it("reconoce el error de límite y no otros", () => {
    expect(isAILimitError(LIMIT)).toBe(true);
    expect(isAILimitError("Your credit balance is too low to access the Anthropic API")).toBe(true);
    expect(isAILimitError("json_invalido")).toBe(false);
    expect(isAILimitError(undefined)).toBe(false);
  });
  it("pausa hasta la fecha que informa la API", () => {
    const now = Date.parse("2026-11-23T10:00:00Z");
    expect(pauseAIFor(LIMIT, now)).toBe(Date.parse("2026-12-01T00:00:00Z"));
    expect(aiPausedUntil(now)).toBe(Date.parse("2026-12-01T00:00:00Z"));
    expect(aiPausedUntil(Date.parse("2026-12-01T00:00:01Z"))).toBeNull();
  });
  it("sin fecha: pausa 1 hora", () => {
    const now = Date.parse("2026-11-23T10:00:00Z");
    expect(pauseAIFor("credit balance is too low", now)).toBe(now + 3_600_000);
  });
});
