import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getSQL: vi.fn(),
  ensureSchema: vi.fn(),
  isLocalDevDemoMode: vi.fn(),
  getCrawlStatsSafe: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL, ensureSchema: mocks.ensureSchema }));
vi.mock("@/lib/local-dev", () => ({ isLocalDevDemoMode: mocks.isLocalDevDemoMode }));
vi.mock("@/lib/gsc-crawl-stats", () => ({ getCrawlStatsSafe: mocks.getCrawlStatsSafe }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/google-auth", () => ({ getGoogleAuth: vi.fn() }));
vi.mock("@/lib/backlink-data", () => ({ isVerifiedBacklinkRow: vi.fn(() => true) }));
vi.mock("@/lib/cron-auth", () => ({ requireCronOrUser: vi.fn() }));
vi.mock("@/lib/llm-scan", () => ({
  scanCompetitors: vi.fn(),
  scoreReadiness: vi.fn(() => ({ score: 0, recommendations: [] })),
}));

import { GET as getContentDecay } from "./content-decay/route";
import { GET as getCtrOpportunities } from "./ctr-opportunities/route";
import { GET as getCrossDomainCannibal } from "./cross-domain-cannibal/route";
import { GET as getCtrAnomaly } from "./ctr-anomaly/route";
import { GET as getCannibalization } from "./cannibalization/route";
import { GET as getKeywordHistory } from "./keyword-history/route";
import { GET as getRankTrackerStatus } from "./rank-tracker/status/route";
import { GET as getRankTrackerHistory } from "./rank-tracker/history/route";
import { GET as getSeoHealth } from "./seo-health/route";
import { GET as getAnalytics } from "./analytics/route";
import { GET as getAioDetector } from "./aio-detector/route";
import { GET as getGscLinks } from "./gsc-links/route";
import { GET as getCompetitorLlmScans } from "./competitors/llm-scan/route";

type GetHandler = (request: NextRequest) => Promise<Response>;

const routes: Array<{ name: string; path: string; handler: GetHandler }> = [
  { name: "content-decay", path: "/api/content-decay", handler: getContentDecay },
  { name: "ctr-opportunities", path: "/api/ctr-opportunities", handler: getCtrOpportunities },
  { name: "cross-domain-cannibal", path: "/api/cross-domain-cannibal", handler: getCrossDomainCannibal },
  { name: "ctr-anomaly", path: "/api/ctr-anomaly", handler: getCtrAnomaly },
  { name: "cannibalization", path: "/api/cannibalization", handler: getCannibalization },
  { name: "keyword-history", path: "/api/keyword-history", handler: getKeywordHistory },
  { name: "rank-tracker/status", path: "/api/rank-tracker/status", handler: getRankTrackerStatus },
  { name: "rank-tracker/history", path: "/api/rank-tracker/history", handler: getRankTrackerHistory },
  { name: "seo-health", path: "/api/seo-health", handler: getSeoHealth },
  { name: "analytics", path: "/api/analytics", handler: getAnalytics },
  { name: "aio-detector", path: "/api/aio-detector", handler: getAioDetector },
  { name: "gsc-links", path: "/api/gsc-links", handler: getGscLinks },
  { name: "competitors/llm-scan", path: "/api/competitors/llm-scan", handler: getCompetitorLlmScans },
];

describe("sensitive GET route authentication", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockReset();
    mocks.getSQL.mockReset();
    mocks.ensureSchema.mockReset();
    mocks.isLocalDevDemoMode.mockReset();
    mocks.getCrawlStatsSafe.mockReset();
    mocks.requireApiSession.mockResolvedValue({
      session: null,
      unauthorized: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    });
  });

  it.each(routes)("protects $name before validation or data access", async ({ path, handler }) => {
    const response = await handler(new NextRequest(`http://dashboard.test${path}`));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(mocks.requireApiSession).toHaveBeenCalledTimes(1);
    expect(mocks.getSQL).not.toHaveBeenCalled();
    expect(mocks.ensureSchema).not.toHaveBeenCalled();
    expect(mocks.isLocalDevDemoMode).not.toHaveBeenCalled();
    expect(mocks.getCrawlStatsSafe).not.toHaveBeenCalled();
  });
});
