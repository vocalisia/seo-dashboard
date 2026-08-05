import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ getSQL: vi.fn() }));

import { buildStoredOpportunityValidation } from "./route";

describe("stored opportunity validation", () => {
  it("uses recorded evidence but never invents SEO metrics", () => {
    const validation = buildStoredOpportunityValidation(
      "audit seo",
      ["audit seo"],
      [{ url: "https://one.example/a" }, { url: "https://two.example/b" }],
      {
        relatedQuestions: ["Comment faire un audit SEO ?"],
        relatedSearches: ["audit technique"],
        resultTitles: ["Audit SEO"],
        resultUrls: [],
      },
    );
    expect(validation.verdict).toBe("RISKY");
    expect(validation.time_to_page1_months).toBeNull();
    expect(validation.keyword_analysis[0].estimated_difficulty).toBe("unknown");
    expect(validation.keyword_analysis[0].avg_competitor_dr).toBeNull();
    expect(validation.keyword_analysis[0].google_position).toBeNull();
    expect(validation.attackability_score).toBeLessThanOrEqual(60);
  });

  it("returns NO_GO instead of a fabricated favorable score when evidence is missing", () => {
    const validation = buildStoredOpportunityValidation(
      "audit seo",
      ["audit seo"],
      [],
      { relatedQuestions: [], relatedSearches: [], resultTitles: [], resultUrls: [] },
    );
    expect(validation.verdict).toBe("NO_GO");
    expect(validation.attackability_score).toBe(0);
  });
});
