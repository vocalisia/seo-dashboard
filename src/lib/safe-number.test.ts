import { describe, expect, it } from "vitest";
import { formatFixed, toFiniteNumber, toFiniteNumberOrNull } from "./safe-number";

describe("safe-number helpers", () => {
  it("accepts numeric strings from SQL drivers", () => {
    expect(toFiniteNumber("12.34")).toBe(12.34);
    expect(formatFixed("12.34", 1)).toBe("12.3");
  });

  it("falls back for empty or invalid values", () => {
    expect(toFiniteNumber("", 9)).toBe(9);
    expect(toFiniteNumber("not-a-number", 9)).toBe(9);
    expect(toFiniteNumberOrNull(undefined)).toBeNull();
    expect(formatFixed(undefined)).toBe("-");
  });
});
