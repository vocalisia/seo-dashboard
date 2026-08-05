import { describe, expect, it } from "vitest";
import { buildPublicCompetitorResearch } from "@/lib/competitor-public-research";
import type { WebResearchReport } from "@/lib/web-research";

function source(
  id: string,
  domain: string,
  title: string,
  headings: string[],
): WebResearchReport["sources"][number] {
  return {
    id,
    url: `https://${domain}/guide`,
    domain,
    title,
    snippet: "",
    providers: ["bing_rss"],
    positions: { bing_rss: 1 },
    fetch_status: "ok" as const,
    description: `Source ${domain}`,
    headings,
    schema_types: [],
    word_count: 500,
    excerpt: "Extrait vérifié.",
  };
}

describe("public competitor keyword extraction", () => {
  it("extracts visible phrases while excluding own and portfolio domains", () => {
    const report = {
      query: "bourse suisse",
      locale: "fr-FR",
      generated_at: "2026-08-05T10:00:00.000Z",
      data_status: "complete",
      search_providers: { bing_rss: "ok", duckduckgo_html: "empty" },
      answer: "",
      evidence: [],
      sources: [
        source("S1", "boursier.ch", "Bourse suisse", ["Cours des actions suisses"]),
        source("S2", "cash.ch", "Bourse suisse aujourd'hui | cash.ch", ["Actions suisses à surveiller", "Prévisions du marché"]),
        source("S3", "zonebourse.com", "Marchés financiers suisses", ["Meilleures actions suisses", "Analyse du SMI"]),
        source("S4", "sister.example.org", "Site du portfolio", ["Expression à exclure"]),
      ],
    } satisfies WebResearchReport;

    const result = buildPublicCompetitorResearch(report, {
      ownDomain: "boursier.ch",
      portfolioDomains: ["sister.example.org"],
      ownKeywords: ["Analyse du SMI"],
    });

    expect(result.competitors.map((item) => item.domain).sort()).toEqual(["cash.ch", "zonebourse.com"]);
    expect(result.gaps.some((item) => item.keyword === "Actions suisses à surveiller")).toBe(true);
    expect(result.gaps.some((item) => item.keyword === "Analyse du SMI")).toBe(false);
    expect(result.gaps.every((item) =>
      item.volume === 0 &&
      item.competitor_position === 0 &&
      item.difficulty === "unknown" &&
      item.source === "public_web"
    )).toBe(true);
  });
});
