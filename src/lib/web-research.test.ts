import { describe, expect, it } from "vitest";
import {
  buildResearchEvidence,
  canonicalizeResearchUrl,
  decodeHtmlEntities,
  mergeSearchResults,
  parseBingRss,
  parseDuckDuckGoHtml,
} from "@/lib/web-research";

describe("no-key web research", () => {
  it("keeps malformed numeric entities harmless", () => {
    expect(decodeHtmlEntities("ok &#99999999; fin")).toBe("ok &#99999999; fin");
  });

  it("canonicalizes public URLs and removes tracking", () => {
    expect(canonicalizeResearchUrl("https://www.Example.com/guide/?utm_source=test&utm_campaign_id=42&b=2&a=1#x"))
      .toBe("https://www.example.com/guide?a=1&b=2");
    expect(() => canonicalizeResearchUrl("http://127.0.0.1/private")).toThrow();
  });

  it("parses Bing RSS including CDATA into explicitly sourced results", () => {
    const results = parseBingRss(`<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[Guide SEO &amp; Suisse]]></title><link><![CDATA[https://example.com/seo?utm_source=x]]></link><description><![CDATA[Une méthode documentée.]]></description></item>
      <item><title>Second</title><link>https://other.org/page</link><description>Autre source.</description></item>
    </channel></rss>`);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://example.com/seo",
      title: "Guide SEO & Suisse",
      providers: ["bing_rss"],
      positions: { bing_rss: 1 },
    });
  });

  it("parses DuckDuckGo redirect URLs without treating them as sources", () => {
    const html = `<body><div class="result results_links">
      <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Farticle">Article fiable</a></h2>
      <a class="result__snippet">Résumé de la page.</a>
    </div></body>`;
    const results = parseDuckDuckGoHtml(html);

    expect(results[0]).toMatchObject({
      url: "https://example.org/article",
      domain: "example.org",
      title: "Article fiable",
      snippet: "Résumé de la page.",
    });
  });

  it("merges provider consensus while preserving provider positions", () => {
    const bing = parseBingRss(`<rss><channel><item><title>A</title><link>https://example.com/a</link><description>A</description></item></channel></rss>`);
    const duck = parseDuckDuckGoHtml(`<body><div class="result results_links"><a class="result__a" href="https://example.com/a">A</a></div></body>`);
    const [merged] = mergeSearchResults([bing, duck]);

    expect(merged.providers.sort()).toEqual(["bing_rss", "duckduckgo_html"]);
    expect(merged.positions).toEqual({ bing_rss: 1, duckduckgo_html: 1 });
  });

  it("keeps the best duplicate position reported by the same provider", () => {
    const first = parseBingRss(`<rss><channel><item><title>A</title><link>https://www.example.com/a</link><description>A</description></item></channel></rss>`)[0];
    const later = { ...first, url: "https://example.com/a", positions: { bing_rss: 7 } as const };
    const [merged] = mergeSearchResults([[first], [later]]);
    expect(merged.positions.bing_rss).toBe(1);
    expect(merged.url).toBe("https://www.example.com/a");
  });

  it("builds evidence only from crawled excerpts and never invents market metrics", () => {
    type EvidenceSource = Parameters<typeof buildResearchEvidence>[1][number];
    const source: EvidenceSource = {
      id: "S1",
      url: "https://example.com/audit",
      domain: "example.com",
      title: "Audit SEO suisse",
      snippet: "",
      providers: ["bing_rss"],
      positions: { bing_rss: 1 },
      fetch_status: "ok",
      description: "",
      headings: [],
      schema_types: [],
      word_count: 12,
      excerpt: "Un audit SEO suisse vérifie les données Search Console et les pages réellement accessibles.",
      body_text: "Un audit SEO suisse vérifie les données Search Console et les pages réellement accessibles. Cette autre phrase ne concerne pas le sujet.",
    };
    const evidence = buildResearchEvidence("audit SEO suisse", [source]);

    expect(evidence[0]).toMatchObject({ source_id: "S1" });
    expect(evidence[0].claim).toContain("audit SEO suisse");
    expect(source.excerpt).toContain(evidence[0].claim);
    expect(evidence[0]).not.toHaveProperty("volume");
    expect(evidence[0]).not.toHaveProperty("keyword_difficulty");

    expect(buildResearchEvidence("audit SEO suisse", [{ ...source, fetch_status: "search_only" }])).toEqual([]);
  });
});
