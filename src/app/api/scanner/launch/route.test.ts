import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  initDB: vi.fn(),
  buildLaunchPlan: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: async () => ({
    session: { user: { email: "tester@example.com" } },
    unauthorized: null,
  }),
}));
vi.mock("@/lib/db", () => ({
  getSQL: () => mocks.sql,
  initDB: mocks.initDB,
}));
vi.mock("@/lib/scanner-enrichment", () => ({
  buildLaunchPlan: mocks.buildLaunchPlan,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.logInfo },
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://dashboard.test/api/scanner/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("scanner launch provisioning truth", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.initDB.mockReset().mockResolvedValue(undefined);
    mocks.buildLaunchPlan.mockReset().mockReturnValue({
      pillar_topic: "audit seo",
      launch_horizon_days: 14,
      articles: [{
        title: "Audit SEO en Suisse",
        target_keyword: "audit seo suisse",
        intent: "informational",
        word_count_target: 1800,
        priority: 1,
      }],
    });
    mocks.logInfo.mockReset();

    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.from(strings).join("?");
      if (query.includes("FROM market_opportunities")) {
        return Promise.resolve([{
          id: 12,
          niche: "Audit SEO",
          site_type: "blog",
          core_keywords: ["audit seo suisse"],
          sample_queries: [],
          serp_evidence: { relatedQuestions: [] },
          suggested_domains: ["audit-seo-suisse.ch"],
          target_languages: ["fr"],
          status: "pending",
          launch_plan: null,
        }]);
      }
      if (query.includes("SELECT id FROM sites")) return Promise.resolve([]);
      if (query.includes("INSERT INTO sites")) return Promise.resolve([{ id: 42 }]);
      return Promise.resolve([]);
    });
  });

  it("registers an inactive site without claiming a repository or deployment", async () => {
    const response = await POST(request({ opportunity_id: 12, domain: "audit-seo-suisse.ch" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      provisioning_status: "site_registered",
      site_registered: true,
      repository_ready: false,
      deployed: false,
      site_active: false,
    });
    expect(body.message).toContain("Aucun dépôt GitHub ni déploiement n'a été créé");

    const updateQuery = mocks.sql.mock.calls
      .map(([strings]) => Array.from(strings as TemplateStringsArray).join("?"))
      .find((query) => query.includes("UPDATE market_opportunities"));
    expect(updateQuery).toContain("SET status = 'site_registered'");
  });
});
