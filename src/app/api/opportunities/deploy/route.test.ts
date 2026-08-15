import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  publishToGitHub: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: async () => ({
    session: { user: { email: "tester@example.com" } },
    unauthorized: null,
  }),
}));
vi.mock("@/lib/db", () => ({ getSQL: () => mocks.sql }));
vi.mock("@/lib/github", () => ({ publishToGitHub: mocks.publishToGitHub }));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://dashboard.test/api/opportunities/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("opportunity repository provisioning truth", () => {
  const previousToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    mocks.sql.mockReset();
    mocks.publishToGitHub.mockReset().mockResolvedValue(undefined);
    mocks.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({
      full_name: "owner/audit-seo-suisse",
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.from(strings).join("?");
      if (query.includes("FROM market_opportunities")) {
        return Promise.resolve([{
          id: 12,
          niche: "Audit SEO",
          site_type: "blog",
          monetization: "lead generation",
          seed_articles: ["Audit SEO en Suisse"],
        }]);
      }
      if (query.includes("SELECT id FROM sites")) return Promise.resolve([{ id: 42 }]);
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  });

  it("reports a ready repository and an inactive, undeployed site as separate states", async () => {
    const response = await POST(request({ opportunity_id: 12, domain: "audit-seo-suisse.ch" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      deployment_status: "repository_ready",
      provisioning_status: "repository_ready",
      site_registered: true,
      repository_ready: true,
      deployed: false,
      site_active: false,
      published: false,
    });
    expect(body.message).toContain("reste inactif");
    expect(body.message).toContain("n'est pas publié");

    const updateQuery = mocks.sql.mock.calls
      .map(([strings]) => Array.from(strings as TemplateStringsArray).join("?"))
      .find((query) => query.includes("UPDATE market_opportunities"));
    expect(updateQuery).toContain("SET status = 'repository_ready'");
  });
});
