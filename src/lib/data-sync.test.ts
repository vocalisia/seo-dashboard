import { describe, expect, it } from "vitest";
import { mapWithConcurrency, parseSyncDays } from "./data-sync";

describe("parseSyncDays", () => {
  it("honors the seven-day daily refresh window", () => {
    expect(parseSyncDays("7")).toBe(7);
  });

  it("uses a safe default and clamps the accepted range", () => {
    expect(parseSyncDays(null)).toBe(45);
    expect(parseSyncDays("invalid")).toBe(45);
    expect(parseSyncDays("0")).toBe(1);
    expect(parseSyncDays("999")).toBe(365);
  });
});

describe("mapWithConcurrency", () => {
  it("keeps result order and bounds concurrent work", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return value * 2;
    });

    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
