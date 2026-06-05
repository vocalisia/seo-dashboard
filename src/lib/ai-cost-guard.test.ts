import { afterEach, describe, expect, it } from "vitest";
import { isPaidFallbackEnabled, paidFallbackDisabledMessage } from "./ai-cost-guard";

const originalEnv = {
  AI_LIVE_ENABLED: process.env.AI_LIVE_ENABLED,
  ENABLE_LIVE_AI: process.env.ENABLE_LIVE_AI,
  AI_PAID_FALLBACK_ENABLED: process.env.AI_PAID_FALLBACK_ENABLED,
};

function restoreEnv(
  name: "AI_LIVE_ENABLED" | "ENABLE_LIVE_AI" | "AI_PAID_FALLBACK_ENABLED",
  value: string | undefined
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("ai cost guard", () => {
  afterEach(() => {
    restoreEnv("AI_LIVE_ENABLED", originalEnv.AI_LIVE_ENABLED);
    restoreEnv("ENABLE_LIVE_AI", originalEnv.ENABLE_LIVE_AI);
    restoreEnv("AI_PAID_FALLBACK_ENABLED", originalEnv.AI_PAID_FALLBACK_ENABLED);
  });

  it("keeps paid fallback providers disabled by default", () => {
    delete process.env.AI_LIVE_ENABLED;
    delete process.env.ENABLE_LIVE_AI;
    delete process.env.AI_PAID_FALLBACK_ENABLED;

    expect(isPaidFallbackEnabled()).toBe(false);
  });

  it("allows paid fallback providers only when explicitly enabled", () => {
    process.env.AI_PAID_FALLBACK_ENABLED = "true";

    expect(isPaidFallbackEnabled()).toBe(true);
  });

  it("does not treat legacy live flags as paid fallback permission", () => {
    delete process.env.AI_PAID_FALLBACK_ENABLED;
    process.env.AI_LIVE_ENABLED = "true";
    process.env.ENABLE_LIVE_AI = "true";

    expect(isPaidFallbackEnabled()).toBe(false);
  });

  it("returns an operator-facing disabled message for fallbacks", () => {
    expect(paidFallbackDisabledMessage("Anthropic")).toContain("AI_PAID_FALLBACK_ENABLED=true");
  });
});
