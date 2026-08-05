import { describe, expect, it, vi } from "vitest";
import type { WebSearchResult } from "@/lib/web-research";

vi.mock("@/lib/db", () => ({ getSQL: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ requireCronOrUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { selectPublicSnapshot } from "./route";

function result(
  url: string,
  providers: WebSearchResult["providers"],
  positions: WebSearchResult["positions"],
): WebSearchResult {
  const domain = new URL(url).hostname;
  return { url, domain, title: domain, snippet: "", providers, positions };
}

describe("SERP verification source boundaries", () => {
  const results = [
    result("https://one.example.org/a", ["bing_rss", "duckduckgo_html"], {
      bing_rss: 8,
      duckduckgo_html: 1,
    }),
    result("https://two.example.org/a", ["bing_rss"], { bing_rss: 2 }),
  ];

  it("keeps a single provider and its own positions", () => {
    const snapshot = selectPublicSnapshot(results, {
      bing_rss: "ok",
      duckduckgo_html: "ok",
    });
    expect(snapshot?.source).toBe("bing_rss");
    expect(snapshot?.entries.map((entry) => entry.position)).toEqual([2, 8]);
  });

  it("falls back without blending ranks", () => {
    const snapshot = selectPublicSnapshot(results, {
      bing_rss: "failed",
      duckduckgo_html: "ok",
    });
    expect(snapshot?.source).toBe("duckduckgo_html");
    expect(snapshot?.entries.map((entry) => entry.position)).toEqual([1]);
  });
});
