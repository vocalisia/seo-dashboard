import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  runWebResearch: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: async () => ({
    session: { user: { email: "tester@example.com" } },
    unauthorized: null,
  }),
}));

vi.mock("@/lib/db", () => ({
  getSQL: () => mocks.sql,
}));

vi.mock("@/lib/web-research", () => ({
  runWebResearch: mocks.runWebResearch,
}));

import { POST, researchDocumentId } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://dashboard.test/api/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function report(status: "complete" | "partial" | "unavailable" = "complete") {
  return {
    query: "audit SEO suisse",
    locale: "fr-FR",
    generated_at: "2026-08-05T10:00:00.000Z",
    data_status: status,
    search_providers: { bing_rss: "ok", duckduckgo_html: "ok" },
    answer: "Synthèse [S1]",
    evidence: [{ source_id: "S1", claim: "Claim sourcé", score: 2 }],
    sources: [{
      id: "S1",
      url: "https://example.com/audit",
      domain: "example.com",
      title: "Audit",
      snippet: "",
      providers: ["bing_rss"],
      positions: { bing_rss: 1 },
      fetch_status: "ok",
      description: "",
      headings: [],
      schema_types: [],
      word_count: 100,
      excerpt: "Claim sourcé",
    }],
  };
}

function sqlText(strings: TemplateStringsArray | string): string {
  return Array.isArray(strings) ? strings.join("?") : String(strings);
}

describe("research API truth and cache contracts", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.runWebResearch.mockReset();
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = sqlText(strings);
      if (text.includes("SELECT response")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it("rejects invalid input before touching providers or database", async () => {
    const response = await POST(request({ query: "x" }));
    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.runWebResearch).not.toHaveBeenCalled();
  });

  it("uses a stable URL hash instead of report-local S1 identifiers", () => {
    const first = researchDocumentId("https://example.com/audit");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(researchDocumentId("https://example.com/audit")).toBe(first);
    expect(researchDocumentId("https://example.com/other")).not.toBe(first);
  });

  it("returns a fresh cache entry without launching web research", async () => {
    const cached = report("complete");
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      if (sqlText(strings).includes("SELECT response")) {
        return Promise.resolve([{ response: cached, researched_at: "2026-08-05T10:00:00.000Z" }]);
      }
      return Promise.resolve([]);
    });
    const response = await POST(request({ query: "audit SEO suisse" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, cached: true, report: cached });
    expect(mocks.runWebResearch).not.toHaveBeenCalled();
  });

  it("caches usable evidence but never caches an unavailable provider outage", async () => {
    mocks.runWebResearch.mockResolvedValueOnce(report("partial"));
    const usableResponse = await POST(request({ query: "audit SEO suisse", force_refresh: true }));
    expect(usableResponse.status).toBe(200);
    expect(mocks.sql.mock.calls.some(([strings]) => sqlText(strings).includes("INSERT INTO web_research_cache"))).toBe(true);

    mocks.sql.mockClear();
    mocks.sql.mockResolvedValue([]);
    mocks.runWebResearch.mockResolvedValueOnce(report("unavailable"));
    const outageResponse = await POST(request({ query: "audit technique SEO", force_refresh: true }));
    expect(outageResponse.status).toBe(502);
    expect(mocks.sql.mock.calls.some(([strings]) => sqlText(strings).includes("INSERT INTO web_research_cache"))).toBe(false);
  });

  it("reports infrastructure failures as server errors, not bad user input", async () => {
    mocks.sql.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request({ query: "audit SEO suisse" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: "database unavailable" });
  });
});
