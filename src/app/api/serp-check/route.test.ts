import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchSource } from "@/lib/web-research";

const mocks = vi.hoisted(() => ({
  runWebResearch: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: async () => ({ session: { user: { email: "tester@example.com" } }, unauthorized: null }),
}));
vi.mock("@/lib/web-research", () => ({ runWebResearch: mocks.runWebResearch }));

import { POST, sourceMatchesExactQuery } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://dashboard.test/api/serp-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function report(status: "complete" | "unavailable" = "complete") {
  return {
    query: "audit SEO",
    locale: "fr-FR",
    generated_at: "2026-08-05T10:00:00.000Z",
    data_status: status,
    search_providers: { bing_rss: status === "unavailable" ? "failed" : "ok", duckduckgo_html: "failed" },
    answer: status === "unavailable" ? "Aucune source" : "Synthèse [S1]",
    evidence: [],
    sources: status === "unavailable" ? [] : [{
      id: "S1",
      url: "https://www.example.com/audit",
      domain: "www.example.com",
      title: "Audit",
      snippet: "",
      providers: ["bing_rss"],
      positions: { bing_rss: 1 },
      matched_queries: ["audit SEO"],
      fetch_status: "ok",
      description: "",
      headings: [],
      schema_types: [],
      word_count: 100,
      excerpt: "Audit",
    }],
  };
}

const expandedQuerySource = {
  id: "S1",
  url: "https://example.org/",
  domain: "example.org",
  title: "Example",
  snippet: "",
  providers: ["bing_rss"],
  positions: { bing_rss: 1 },
  matched_queries: ["audit seo définition"],
  fetch_status: "search_only",
  description: "",
  headings: [],
  schema_types: [],
  word_count: 0,
  excerpt: "",
} satisfies ResearchSource;

describe("sourced SERP check", () => {
  beforeEach(() => mocks.runWebResearch.mockReset());

  it("validates the query before research", async () => {
    const response = await POST(request({ query: "x" }));
    expect(response.status).toBe(400);
    expect(mocks.runWebResearch).not.toHaveBeenCalled();
  });

  it("returns sources and explicitly refuses to label them Google positions", async () => {
    mocks.runWebResearch.mockResolvedValueOnce(report());
    const response = await POST(request({ query: "audit SEO", site_url: "example.com" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ranking_scope).toContain("bing_rss");
    expect(body.ranking_notice).toContain("jamais présentées comme des positions Google");
    expect(body.site.visible_in_sources).toBe(true);
    expect(body.sources).toHaveLength(1);
  });

  it("exposes a provider outage instead of returning invented results", async () => {
    mocks.runWebResearch.mockResolvedValueOnce(report("unavailable"));
    const response = await POST(request({ query: "audit SEO" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, data_status: "unavailable", sources: [] });
  });
});

describe("exact SERP query boundary", () => {
  it("does not claim visibility from an expanded query", () => {
    expect(sourceMatchesExactQuery(expandedQuerySource, "audit seo")).toBe(false);
  });

  it("normalizes case and whitespace for the exact query only", () => {
    expect(sourceMatchesExactQuery(expandedQuerySource, "  AUDIT SEO DÉFINITION ")).toBe(true);
  });
});
