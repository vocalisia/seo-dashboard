import { describe, expect, it, vi } from "vitest";
import type { WebSearchResult } from "@/lib/web-research";

vi.mock("@/lib/db", () => ({ getSQL: vi.fn() }));
vi.mock("@/lib/ai-cache", () => ({ askAICached: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ requireCronOrUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { resultsForSource, selectResultSnapshot } from "./route";

function result(
  url: string,
  providers: WebSearchResult["providers"],
  positions: WebSearchResult["positions"],
): WebSearchResult {
  const domain = new URL(url).hostname;
  return { url, domain, title: domain, snippet: "", providers, positions };
}

describe("SERP snapshot source boundaries", () => {
  const results = [
    result("https://one.example.org/a", ["bing_rss", "duckduckgo_html"], { bing_rss: 6, duckduckgo_html: 1 }),
    result("https://two.example.org/a", ["bing_rss"], { bing_rss: 2 }),
  ];

  it("sorts positions only inside the selected provider", () => {
    const bing = resultsForSource(results, "bing_rss");
    expect(bing.map((entry) => entry.position)).toEqual([2, 6]);
    expect(bing.every((entry) => entry.source === "bing_rss")).toBe(true);
  });

  it("uses DuckDuckGo only when Bing has no usable snapshot", () => {
    const snapshot = selectResultSnapshot(results, {
      bing_rss: "failed",
      duckduckgo_html: "ok",
    });
    expect(snapshot?.source).toBe("duckduckgo_html");
    expect(snapshot?.results).toHaveLength(1);
    expect(snapshot?.results[0].position).toBe(1);
  });

  it("keeps the provider identity instead of presenting a blended Google rank", () => {
    const snapshot = selectResultSnapshot(results, {
      bing_rss: "ok",
      duckduckgo_html: "ok",
    });
    expect(snapshot?.source).toBe("bing_rss");
    expect(snapshot?.results.map((entry) => entry.source)).toEqual(["bing_rss", "bing_rss"]);
  });
});
