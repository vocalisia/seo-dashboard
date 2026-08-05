import { describe, expect, it } from "vitest";
import { hasGscVisibility, normalizeGscPageUrl } from "@/lib/gsc-page-visibility";

describe("GSC page visibility", () => {
  it("normalizes canonical page URL variants", () => {
    expect(normalizeGscPageUrl("https://www.example.com/guide/?utm=x#section")).toBe("https://example.com/guide");
    expect(normalizeGscPageUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("requires observed GSC impressions before claiming visibility", () => {
    expect(hasGscVisibility(0)).toBe(false);
    expect(hasGscVisibility(null)).toBe(false);
    expect(hasGscVisibility(1)).toBe(true);
  });
});
