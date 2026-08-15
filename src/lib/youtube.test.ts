import { describe, expect, it } from "vitest";
import { classifyYouTubeMonetization, parseYouTubeCount } from "./youtube";

describe("YouTube monetization signal", () => {
  it("returns a category, never an invented monetary range", () => {
    expect(classifyYouTubeMonetization("finance personnelle")).toBe("high");
    expect(classifyYouTubeMonetization("formation intelligence artificielle")).toBe("medium");
    expect(classifyYouTubeMonetization("vlog musique")).toBe("low");
  });
});

describe("YouTube public counters", () => {
  it("parses French and English abbreviated counters without inventing values", () => {
    expect(parseYouTubeCount("20,1 k abonnés")).toBe(20_100);
    expect(parseYouTubeCount("1.2M views")).toBe(1_200_000);
    expect(parseYouTubeCount("83 245 vues")).toBe(83_245);
    expect(parseYouTubeCount("non exposé")).toBe(0);
  });
});
