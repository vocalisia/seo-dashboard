import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: async () => ({
    session: { user: { email: "tester@example.com" } },
    unauthorized: null,
  }),
}));
vi.mock("@/lib/db", () => ({ getSQL: () => mocks.sql }));
vi.mock("@/lib/competitor-research-schema", () => ({
  ensureCompetitorResearchSchema: async () => undefined,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET } from "./route";

describe("competitor keyword detail", () => {
  beforeEach(() => mocks.sql.mockReset());

  it("rejects a malformed site id before querying the database", async () => {
    const response = await GET(new NextRequest(
      "http://dashboard.test/api/competitors/keywords?site_id=1x&competitor_domain=example.com",
    ));
    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns observed keywords and only a verified imported volume", async () => {
    mocks.sql.mockResolvedValueOnce([{
      keyword: "audit seo suisse",
      estimated_volume: 1300,
      volume_source: "google_kp_real_csv_ch",
      competitor_position: null,
      difficulty: null,
      intent: "commercial",
    }]);

    const response = await GET(new NextRequest(
      "http://dashboard.test/api/competitors/keywords?site_id=2&competitor_domain=example.com",
    ));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.total_keywords).toBe(1);
    expect(body.categories.general.top[0]).toMatchObject({
      keyword: "audit seo suisse",
      volume: 1300,
      volume_source: "google_kp_real_csv_ch",
      position: 0,
    });
    expect(body.metric_boundaries.position).toBe("not_measured_for_public_research");
  });
});
