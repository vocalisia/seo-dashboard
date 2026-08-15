import { describe, expect, it } from "vitest";
import { buildTrafficSummary } from "./ga4-traffic-summary";

function traffic(siteId: number, users: number, error: string | null) {
  return {
    site_name: `Site ${siteId}`,
    global: { users },
    per_day: { users: users / 28 },
    error,
  };
}

describe("GA4 portfolio summary", () => {
  it("excludes unavailable properties instead of counting them as measured zeros", () => {
    const result = buildTrafficSummary([
      traffic(1, 42, null),
      traffic(2, 0, "provider unavailable"),
    ], "28d");

    expect(result.summary).toMatchObject({
      requested_sites: 2,
      sites_count: 1,
      failed_sites: 1,
      total_users: 42,
    });
    expect(result.summary.top_3.map((site) => site.site)).toEqual(["Site 1"]);
    expect(result.failedResults).toHaveLength(1);
  });

  it("keeps an observed zero as a valid measurement", () => {
    const result = buildTrafficSummary([traffic(1, 0, null)], "28d");

    expect(result.summary.sites_count).toBe(1);
    expect(result.summary.failed_sites).toBe(0);
    expect(result.summary.total_users).toBe(0);
  });
});
