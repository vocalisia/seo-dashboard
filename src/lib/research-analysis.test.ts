import { describe, expect, it } from "vitest";
import {
  buildKeywordClusters,
  buildResearchAnswer,
  buildResearchClaims,
  inferResearchIntent,
  researchRegistrableDomain,
  scoreResearchSources,
} from "@/lib/research-analysis";
import type { CrawledResearchSource, ResearchCoverage } from "@/lib/web-research";

function source(
  id: string,
  domain: string,
  title: string,
  headings: string[],
  excerpt: string,
): CrawledResearchSource {
  return {
    id,
    url: "https://" + domain + "/audit",
    domain,
    title,
    snippet: "",
    providers: id === "S1" ? ["bing_rss", "duckduckgo_html"] : ["bing_rss"],
    positions: { bing_rss: 1 },
    matched_queries: ["audit SEO technique", "audit SEO technique guide"],
    retrieval_score: id === "S1" ? 100 : 70,
    fetch_status: "ok",
    description: title,
    headings,
    schema_types: ["Article"],
    word_count: 1_200,
    excerpt,
    body_text: excerpt,
  };
}

describe("local research analysis", () => {
  it("scores only observable source signals", () => {
    const [scored] = scoreResearchSources("audit SEO technique", [
      source("S1", "admin.ch", "Audit SEO technique", ["Méthode"], "Un contenu suffisamment long pour être analysé."),
    ]);
    expect(scored.source_score).toBeGreaterThan(50);
    expect(scored.source_signals).toContain("crawled_content");
    expect(scored.source_signals).toContain("multi_provider_match");
    expect(scored.source_signals).toContain("institutional_domain");
    expect(scored).not.toHaveProperty("domain_authority");
  });

  it("does not trust a deceptive hostname that merely contains an institutional suffix", () => {
    const [scored] = scoreResearchSources("audit SEO technique", [
      source(
        "S1",
        "admin.ch.attacker.example",
        "Audit SEO technique",
        ["Méthode"],
        "Un contenu suffisamment long pour être analysé.",
      ),
    ]);
    expect(scored.source_signals).not.toContain("institutional_domain");
  });

  it("corroborates similar claims across independent domains and preserves exact excerpts", () => {
    const raw = [
      source(
        "S1",
        "example.org",
        "Audit SEO technique complet",
        ["Audit SEO technique : méthode"],
        "Un audit SEO technique examine les codes HTTP, les balises canoniques et les données Search Console pour identifier les problèmes d’indexation.",
      ),
      source(
        "S2",
        "example.net",
        "Méthode audit SEO",
        ["Guide audit SEO technique"],
        "L’audit SEO technique examine les codes HTTP, les balises canoniques et les données de Search Console afin d’identifier les problèmes d’indexation.",
      ),
    ];
    const scored = scoreResearchSources("audit SEO technique", raw);
    const result = buildResearchClaims("audit SEO technique", scored);
    const corroborated = result.claims.find((claim) => claim.confidence === "corroborated");
    expect(corroborated?.independent_domains).toBe(2);
    expect(corroborated?.source_ids.sort()).toEqual(["S1", "S2"]);
    for (const evidence of result.evidence) {
      const matching = scored.find((item) => item.id === evidence.source_id);
      expect(matching?.excerpt).toContain(evidence.claim);
    }
  });

  it("does not corroborate negated or numerically conflicting claims", () => {
    const scored = scoreResearchSources("audit SEO indexation", [
      source(
        "S1",
        "one.example",
        "Audit SEO",
        ["Indexation"],
        "Un audit SEO indexation confirme que 80 % des pages sont indexées après la correction technique.",
      ),
      source(
        "S2",
        "two.example",
        "Audit SEO",
        ["Indexation"],
        "Un audit SEO indexation ne confirme pas que 20 % des pages sont indexées après la correction technique.",
      ),
    ]);
    const result = buildResearchClaims("audit SEO indexation", scored);
    expect(result.claims.every((claim) => claim.confidence === "single_source")).toBe(true);
  });

  it("treats subdomains of the same registrable domain as one source owner", () => {
    expect(researchRegistrableDomain("news.example.com")).toBe("example.com");
    expect(researchRegistrableDomain("docs.example.com")).toBe("example.com");
    expect(researchRegistrableDomain("service.gov.uk")).toBe("service.gov.uk");
  });

  it("extracts evidence-linked keyword clusters without fake market metrics", () => {
    const scored = scoreResearchSources("audit SEO technique", [
      source(
        "S1",
        "example.org",
        "Audit SEO technique complet",
        ["Checklist audit SEO technique", "Comment vérifier les balises canoniques ?"],
        "Comment vérifier les balises canoniques ? Cette vérification aide à comprendre les problèmes techniques observables.",
      ),
      source(
        "S2",
        "example.net",
        "Guide audit SEO technique",
        ["Checklist pour un audit SEO technique"],
        "Une checklist structurée aide à examiner les éléments techniques du site.",
      ),
    ]);
    const clusters = buildKeywordClusters("audit SEO technique", scored);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.some((cluster) => cluster.source_ids.length >= 2)).toBe(true);
    for (const cluster of clusters) {
      for (const keyword of cluster.keywords) {
        expect(keyword.source_count).toBeGreaterThan(0);
        expect(keyword).not.toHaveProperty("volume");
        expect(keyword).not.toHaveProperty("difficulty");
        expect(keyword).not.toHaveProperty("google_position");
      }
    }
  });

  it("keeps intent classification deterministic and labels answer limitations", () => {
    expect(inferResearchIntent("meilleur outil audit SEO")).toBe("commercial");
    expect(inferResearchIntent("acheter un audit SEO")).toBe("transactional");
    const coverage: ResearchCoverage = {
      queries_planned: 3,
      queries_with_results: 2,
      results_discovered: 8,
      sources_selected: 4,
      sources_crawled: 3,
      independent_domains: 3,
      corroborated_claims: 0,
    };
    const answer = buildResearchAnswer({
      query: "audit SEO",
      claims: [],
      clusters: [],
      sources: [],
      coverage,
    });
    expect(answer).toContain("aucun volume de recherche");
    expect(answer).toContain("aucune position Google");
  });
});
