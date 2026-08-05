import { describe, expect, it } from "vitest";
import {
  deriveExpansionQueries,
  fusePlannedSearchResults,
  planResearchQueries,
  type SearchBatch,
} from "@/lib/web-research-engine";
import type { WebSearchResult } from "@/lib/web-research";

function result(
  url: string,
  title: string,
  provider: "bing_rss" | "duckduckgo_html",
  position: number,
): WebSearchResult {
  return {
    url,
    domain: new URL(url).hostname,
    title,
    snippet: "Méthode audit SEO technique Search Console indexation",
    providers: [provider],
    positions: { [provider]: position },
  };
}

function batch(
  id: string,
  query: string,
  results: WebSearchResult[],
  round: 1 | 2 = 1,
): SearchBatch {
  return {
    plan: { id, query, purpose: round === 1 ? "primary" : "expansion", round, weight: 1 },
    results,
    providers: {
      bing_rss: results.some((item) => item.providers.includes("bing_rss")) ? "ok" : "empty",
      duckduckgo_html: results.some((item) => item.providers.includes("duckduckgo_html")) ? "ok" : "empty",
    },
  };
}

describe("iterative no-key research engine", () => {
  it("builds a bounded, deduplicated deep research plan", () => {
    const plans = planResearchQueries("audit SEO suisse", {
      locale: "fr-CH",
      depth: "deep",
      focus: "competitors",
      maxQueries: 6,
    });
    expect(plans.length).toBeLessThanOrEqual(6);
    expect(plans[0]).toMatchObject({ query: "audit SEO suisse", purpose: "primary", round: 1 });
    expect(plans.some((plan) => plan.query.includes("admin.ch"))).toBe(true);
    expect(new Set(plans.map((plan) => plan.query.toLowerCase())).size).toBe(plans.length);
  });

  it("uses reciprocal-rank fusion and preserves multi-query/provider evidence", () => {
    const batches = [
      batch("Q1", "audit SEO", [
        result("https://example.org/audit", "Audit SEO", "bing_rss", 1),
        result("https://other.net/guide", "Guide SEO", "bing_rss", 2),
      ]),
      batch("Q2", "audit SEO guide", [
        result("https://example.org/audit", "Audit SEO", "duckduckgo_html", 1),
        result("https://third.ch/checklist", "Checklist SEO", "duckduckgo_html", 2),
      ]),
    ];
    const fused = fusePlannedSearchResults(batches, 3);
    expect(fused[0].url).toBe("https://example.org/audit");
    expect(fused[0].matched_queries).toHaveLength(2);
    expect(fused[0].providers.sort()).toEqual(["bing_rss", "duckduckgo_html"]);
    expect(fused[0].retrieval_score).toBe(100);
    expect(new Set(fused.map((item) => item.domain)).size).toBe(3);
  });

  it("expands only terms repeated across independent domains", () => {
    const batches = [
      batch("Q1", "audit SEO", [
        result("https://one.ch/a", "Indexation Search Console", "bing_rss", 1),
        result("https://two.ch/b", "Indexation technique", "bing_rss", 2),
        result("https://three.ch/c", "Mot isolé", "bing_rss", 3),
      ]),
    ];
    const expansions = deriveExpansionQueries("audit SEO", batches, 2, 1);
    expect(expansions.length).toBeGreaterThan(0);
    expect(expansions.some((plan) => plan.query.includes("indexation"))).toBe(true);
    expect(expansions.every((plan) => !plan.query.includes("isolé"))).toBe(true);
    expect(expansions.every((plan) => plan.round === 2)).toBe(true);
  });
});
