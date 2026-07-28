import { describe, expect, it } from "vitest";
import { hasSufficientCompetitorResearch, prepareCompetitorResearchRows } from "./competitor-research-guard";

const competitors = [
  { domain: "alpha.ch", description: "Alpha" },
  { domain: "beta.ch", description: "Beta" },
];

function gap(keyword: string, competitor: string) {
  return { keyword, volume: 100, competitor, competitor_position: 1, difficulty: "low", intent: "info" };
}

describe("competitor research guard", () => {
  it("normalizes valid rows and rejects placeholders", () => {
    const rows = prepareCompetitorResearchRows([
      gap("renovation geneve", "https://www.alpha.ch/offre"),
      gap("fake", "competitor-a.example"),
      gap("invalid", "analyse IA"),
      gap("mail", "mailto:bad@example.com"),
    ], competitors);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ domain: "alpha.ch", keyword: "renovation geneve" });
  });

  it("does not allow a sparse scan to replace existing research", () => {
    const rows = prepareCompetitorResearchRows([
      gap("one", "alpha.ch"),
      gap("two", "alpha.ch"),
    ], competitors);

    expect(hasSufficientCompetitorResearch(rows)).toBe(false);
  });

  it("requires distinct keyword and domain evidence", () => {
    const repeatedKeyword = prepareCompetitorResearchRows([
      gap("same keyword", "alpha.ch"),
      gap("same keyword", "beta.ch"),
      gap("same keyword", "gamma.ch"),
    ], competitors);
    const sufficient = prepareCompetitorResearchRows([
      gap("one", "alpha.ch"),
      gap("two", "beta.ch"),
      gap("three", "beta.ch"),
    ], competitors);

    expect(hasSufficientCompetitorResearch(repeatedKeyword)).toBe(false);
    expect(hasSufficientCompetitorResearch(sufficient)).toBe(true);
  });
});