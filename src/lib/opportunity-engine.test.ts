import { describe, expect, it } from "vitest";

import {
  buildOpportunityCandidates,
  classifyIntent,
  isQuestionKeyword,
  scoreKeywordSignal,
  type OpportunityKeywordRow,
} from "./opportunity-engine";

const rows: OpportunityKeywordRow[] = [
  {
    query: "comment choisir mutuelle senior pas cher",
    impressions_30d: 22000,
    impressions_prev_30d: 4000,
    clicks_30d: 120,
    avg_position_30d: 18,
    site_count: 1,
  },
  {
    query: "mutuelle senior comparatif remboursement",
    impressions_30d: 18000,
    impressions_prev_30d: 3500,
    clicks_30d: 90,
    avg_position_30d: 21,
    site_count: 1,
  },
  {
    query: "prix borne recharge copropriete",
    impressions_30d: 16000,
    impressions_prev_30d: 2000,
    clicks_30d: 70,
    avg_position_30d: 24,
    site_count: 1,
  },
];

describe("opportunity-engine helpers", () => {
  it("detects question-style queries", () => {
    expect(isQuestionKeyword("comment choisir mutuelle senior")).toBe(true);
    expect(isQuestionKeyword("mutuelle senior comparatif")).toBe(false);
  });

  it("classifies commercial and informational intent", () => {
    expect(classifyIntent("prix borne recharge copropriete")).toBe("commercial");
    expect(classifyIntent("comment choisir mutuelle senior")).toBe("informational");
  });

  it("scores growing keywords above static ones", () => {
    const hot = scoreKeywordSignal(rows[0]);
    const colder = scoreKeywordSignal({
      ...rows[0],
      impressions_prev_30d: 20000,
      avg_position_30d: 8,
    });
    expect(hot.totalScore).toBeGreaterThan(colder.totalScore);
  });
});

describe("buildOpportunityCandidates", () => {
  it("keeps external discovery qualitative without fabricated SEO metrics", () => {
    const candidates = buildOpportunityCandidates([
      {
        query: "logiciel conformité pme suisse",
        impressions_30d: 0,
        impressions_prev_30d: 0,
        clicks_30d: 0,
        avg_position_30d: 0,
        site_count: 0,
        measurement_kind: "external_signal",
        signal_source: "product_hunt",
      },
    ], {
      minVolume: 100,
      maxCandidates: 10,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      monthlyVolume: 0,
      momentumPct: 0,
      averagePosition: 0,
      measurementKind: "external_signal",
      signalSources: ["product_hunt"],
    });
    expect(candidates[0].scoreBreakdown.volume).toBe(0);
    expect(candidates[0].scoreBreakdown.growth).toBe(0);
    expect(candidates[0].scoreBreakdown.weakness).toBe(0);
    expect(candidates[0].searchVolume).toBeNull();
  });

  it("uses only verified Keyword Planner imports as search volume", () => {
    const candidates = buildOpportunityCandidates([
      {
        ...rows[0],
        search_volume: 1900,
        search_volume_source: "google_kp_real_csv_fr",
      },
      {
        ...rows[1],
        search_volume: 900,
        search_volume_source: "google_kp_real_plan_ch",
      },
    ], { minVolume: 100, maxCandidates: 10 });

    expect(candidates[0].monthlyVolume).toBe(40000);
    expect(candidates[0].searchVolume).toBe(2800);
    expect(candidates[0].searchVolumeSources).toEqual([
      "google_kp_real_csv_fr",
      "google_kp_real_plan_ch",
    ]);
  });

  it("does not promote an unverified number to search volume", () => {
    const candidates = buildOpportunityCandidates([{
      ...rows[0],
      search_volume: 99999,
      search_volume_source: "gsc_derived_estimate",
    }], { minVolume: 100, maxCandidates: 10 });

    expect(candidates[0].searchVolume).toBeNull();
    expect(candidates[0].monthlyVolume).toBe(rows[0].impressions_30d);
  });

  it("clusters related signals and keeps strong opportunities", () => {
    const candidates = buildOpportunityCandidates(rows, {
      minVolume: 5000,
      maxCandidates: 10,
      existingPortfolioHints: ["voice ai", "tesla", "crypto", "cbd"],
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].monthlyVolume).toBeGreaterThanOrEqual(5000);
    expect(candidates.some((c) => c.clusterLabel.includes("mutuelle senior"))).toBe(true);
    expect(candidates[0].scoreBreakdown.growth).toBeGreaterThanOrEqual(0);
    expect(candidates[0].scoreBreakdown.portfolioDistance).toBeGreaterThan(0);
  });

  it("changes ranking based on portfolio preference", () => {
    const mixedRows: OpportunityKeywordRow[] = [
      {
        query: "seo tools audit automation",
        impressions_30d: 11000,
        impressions_prev_30d: 7000,
        clicks_30d: 90,
        avg_position_30d: 16,
        site_count: 1,
      },
      {
        query: "pet cooling mat for dogs",
        impressions_30d: 12000,
        impressions_prev_30d: 3000,
        clicks_30d: 110,
        avg_position_30d: 21,
        site_count: 1,
      },
    ];

    const closeCandidates = buildOpportunityCandidates(mixedRows, {
      minVolume: 5000,
      maxCandidates: 10,
      existingPortfolioHints: ["seo tools", "audit automation"],
      portfolioPreference: "close",
    });

    const distantCandidates = buildOpportunityCandidates(mixedRows, {
      minVolume: 5000,
      maxCandidates: 10,
      existingPortfolioHints: ["seo tools", "audit automation"],
      portfolioPreference: "distant",
    });

    expect(closeCandidates[0]?.clusterLabel).toContain("seo tools");
    expect(distantCandidates[0]?.clusterLabel).toContain("pet cooling mat");
  });
});
