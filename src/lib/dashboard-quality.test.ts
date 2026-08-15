import { describe, expect, it } from "vitest";
import {
  dashboardSiteIssues,
  dashboardSiteStatusLabel,
  summarizeDashboardHealth,
  weightedDashboardPosition,
  type DashboardQualitySite,
} from "./dashboard-quality";

function site(overrides: Partial<DashboardQualitySite>): DashboardQualitySite {
  return {
    id: 1,
    name: "Site",
    latest_gsc_date: "2026-08-12",
    positioned_keywords_30d: 10,
    top10_keywords_7d: 2,
    tracked_keywords: 12,
    kp_volumes_imported: 5,
    kp_volumes_missing: 7,
    gain_candidates: 3,
    latest_ga4_date: "2026-08-12",
    users_30d: 20,
    status: "ok",
    issues: [],
    ...overrides,
  };
}

describe("dashboard quality helpers", () => {
  it("counts every affected site instead of only stale GSC statuses", () => {
    const summary = summarizeDashboardHealth([
      site({ id: 1 }),
      site({ id: 2, status: "gsc_stale", issues: ["gsc_stale", "kp_missing"] }),
      site({ id: 3, status: "ga4_stale", issues: ["ga4_stale"] }),
      site({ id: 4, status: "kp_missing", issues: ["kp_missing"] }),
    ]);

    expect(summary.healthySites).toBe(1);
    expect(summary.issueSites).toBe(3);
    expect(summary.totalIssues).toBe(4);
    expect(summary.gscIssueSites).toBe(1);
    expect(summary.ga4IssueSites).toBe(1);
    expect(summary.kpIssueSites).toBe(2);
  });

  it("falls back to the primary status for older API payloads", () => {
    const legacy = site({ status: "gsc_no_query_data", issues: undefined });
    expect(dashboardSiteIssues(legacy)).toEqual(["gsc_no_query_data"]);
    expect(dashboardSiteStatusLabel(legacy)).toBe("Aucune requête GSC");
  });

  it("uses an impressions-weighted portfolio position", () => {
    expect(weightedDashboardPosition([
      { avg_position_30d: 2, gsc_impressions_30d: 90 },
      { avg_position_30d: 20, gsc_impressions_30d: 10 },
    ])).toBeCloseTo(3.8);
    expect(weightedDashboardPosition([{ avg_position_30d: 0, gsc_impressions_30d: 0 }])).toBeNull();
  });
});
