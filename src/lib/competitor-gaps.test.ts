import { describe, expect, it } from "vitest";
import {
  buildCompetitorArticleRequest,
  competitorContentPlanAvailability,
  isConfirmedCompetitorKeywordResponse,
  isSuccessfulCompetitorResponse,
  sortGapsByKnownVolume,
  toGscOpportunities,
} from "@/lib/competitor-gaps";

describe("competitor gap data contract", () => {
  it("keeps GSC impressions separate from unknown search volume", () => {
    const [opportunity] = toGscOpportunities([
      { keyword: "investir etf suisse", our_position: 47.2, impressions: 234 },
    ]);

    expect(opportunity).toMatchObject({
      keyword: "investir etf suisse",
      our_position: 47.2,
      impressions: 234,
      volume: null,
      source: "gsc_opportunity",
    });
  });

  it("sorts cached rows without treating an unknown volume as zero data", () => {
    const sorted = sortGapsByKnownVolume([
      { keyword: "unknown", our_position: 45, competitor_positions: [], volume: null, source: "gsc_opportunity" },
      { keyword: "known", our_position: 55, competitor_positions: [], volume: 500, source: "competitor_cache" },
    ]);

    expect(sorted.map((row) => row.keyword)).toEqual(["known", "unknown"]);
  });

  it("sends the keyword that was actually clicked to the article preview", () => {
    expect(buildCompetitorArticleRequest(7, "  audit SEO Genève  ")).toEqual({
      site_id: 7,
      dry_run: true,
      language: "fr",
      source: "competitor",
      forced_keyword: "audit SEO Genève",
    });
  });

  it("requires both an OK HTTP response and an explicit success payload", () => {
    expect(isSuccessfulCompetitorResponse(true, { success: true })).toBe(true);
    expect(isSuccessfulCompetitorResponse(false, { success: true })).toBe(false);
    expect(isSuccessfulCompetitorResponse(true, { success: false })).toBe(false);
  });

  it("refuses to confirm an action when the API reports another keyword", () => {
    expect(isConfirmedCompetitorKeywordResponse(true, { success: true, keyword: "audit seo genève" }, "Audit SEO Genève")).toBe(true);
    expect(isConfirmedCompetitorKeywordResponse(true, { success: true, keyword: "autre requête" }, "Audit SEO Genève")).toBe(false);
    expect(isConfirmedCompetitorKeywordResponse(false, { success: true, keyword: "Audit SEO Genève" }, "Audit SEO Genève")).toBe(false);
  });

  it("keeps content-plan disabled with an honest targeted-action explanation", () => {
    const availability = competitorContentPlanAvailability("audit SEO Genève");
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toContain("audit SEO Genève");
    expect(availability.reason).toContain("ne sait pas enregistrer uniquement le mot-clé cliqué");
  });
});
