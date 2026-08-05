import { describe, expect, it, vi } from "vitest";
import type { OpportunityCandidate } from "@/lib/opportunity-engine";

vi.mock("@/lib/api-auth", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ getSQL: vi.fn(), initDB: vi.fn() }));
vi.mock("@/lib/local-dev", () => ({ isLocalDevDemoMode: () => false }));

import { fallbackOpportunity } from "./route";

function candidate(overrides: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    clusterKey: "audit seo",
    clusterLabel: "Audit SEO Suisse",
    keywords: ["audit seo suisse"],
    monthlyVolume: 12000,
    searchVolume: null,
    searchVolumeSources: [],
    momentumPct: 35,
    averagePosition: 18,
    signalScore: 0.72,
    opportunityType: "commercial",
    portfolioDistance: 0.6,
    intent: "commercial",
    sampleQueries: ["audit seo suisse"],
    measurementKind: "gsc",
    signalSources: ["gsc"],
    rationale: ["observed GSC visibility gap"],
    scoreBreakdown: {
      growth: 0.7,
      volume: 0.8,
      weakness: 0.6,
      specificity: 0.7,
      business: 0.8,
      portfolioDistance: 0.6,
    },
    ...overrides,
  };
}

describe("opportunity metric boundaries", () => {
  it("keeps GSC impressions separate from unmeasured search volume", () => {
    const opportunity = fallbackOpportunity(candidate());
    expect(opportunity).toMatchObject({
      monthly_volume: 0,
      gsc_impressions_30d: 12000,
      volume_source: null,
      competition: "unknown",
      projected_traffic_6m: 0,
      projected_revenue_6m: 0,
      success_rate: 0,
      metric_status: "gsc_signal_only",
    });
  });

  it("exposes a volume only when a verified Keyword Planner source exists", () => {
    const opportunity = fallbackOpportunity(candidate({
      searchVolume: 1600,
      searchVolumeSources: ["google_kp_real_csv_ch"],
    }));
    expect(opportunity.monthly_volume).toBe(1600);
    expect(opportunity.volume_source).toBe("google_kp_real_csv_ch");
    expect(opportunity.metric_status).toBe("keyword_planner_measured");
  });
});
