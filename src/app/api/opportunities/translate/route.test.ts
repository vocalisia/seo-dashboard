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

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://dashboard.test/api/opportunities/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("local opportunity translation", () => {
  beforeEach(() => mocks.sql.mockReset());

  it("rejects undocumented target languages without calling a provider or database", async () => {
    const response = await POST(request({ opportunity_id: 12, target: "en" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, api_key_required: false });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("translates the integrated French option with local rules only", async () => {
    mocks.sql.mockResolvedValueOnce([{
      id: 12,
      niche: "AI workflow tools",
      reason: "fast-rising demand",
      seed_articles: ["AI workflow guide"],
      sample_queries: ["best AI workflow"],
      business_model: { type: "saas", how_to_monetize: "ads" },
    }]);

    const response = await POST(request({ opportunity_id: 12, target: "fr" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      source: "local_translation_rules",
      api_key_required: false,
    });
    expect(body.translated.reason).toContain("demande en forte hausse");
  });
});
