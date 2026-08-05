import { describe, expect, it } from "vitest";
import { buildInternalLinkSuggestions, computePageRank, extractInternalLinks, normalizeUrlForGraph } from "@/lib/pagerank-graph";

describe("PageRank graph helpers", () => {
  it("normalizes canonical graph URLs and parses both quote styles", () => {
    expect(normalizeUrlForGraph("https://www.example.com/path/")).toBe("https://example.com/path");

    const links = extractInternalLinks(
      `<a href='/guide/'>Guide</a><a href="/contact">Contact</a><a href="https://other.example/x">Off-site</a><a href="/image.png">Image</a>`,
      "https://example.com/blog/article",
      "example.com",
    );

    expect(links).toEqual(["https://example.com/guide", "https://example.com/contact"]);
  });

  it("resolves relative links from the crawled page rather than the site root", () => {
    expect(extractInternalLinks(
      `<a href="../guide">Guide</a><a href="./suite">Suite</a>`,
      "https://example.com/fr/articles/post",
      "example.com",
    )).toEqual([
      "https://example.com/fr/guide",
      "https://example.com/fr/articles/suite",
    ]);
  });

  it("assigns more PageRank to a page with more observed inbound links", () => {
    const nodes = new Map([
      ["https://example.com/", { url: "https://example.com/", outLinks: ["https://example.com/guide", "https://example.com/contact"], inLinks: [], pr: 0, clicks: 0 }],
      ["https://example.com/guide", { url: "https://example.com/guide", outLinks: ["https://example.com/"], inLinks: [], pr: 0, clicks: 0 }],
      ["https://example.com/contact", { url: "https://example.com/contact", outLinks: ["https://example.com/"], inLinks: [], pr: 0, clicks: 0 }],
    ]);

    computePageRank(nodes, 50, 0.85);

    expect(nodes.get("https://example.com/")!.pr).toBeGreaterThan(nodes.get("https://example.com/guide")!.pr);
    const total = [...nodes.values()].reduce((sum, node) => sum + node.pr, 0);
    expect(total).toBeCloseTo(1, 8);
  });

  it("redistributes dangling PageRank mass", () => {
    const nodes = new Map([
      ["https://example.com/", { url: "https://example.com/", outLinks: ["https://example.com/a"], inLinks: [], pr: 0, clicks: 0 }],
      ["https://example.com/a", { url: "https://example.com/a", outLinks: [], inLinks: [], pr: 0, clicks: 0 }],
    ]);
    computePageRank(nodes, 100, 0.85);
    expect([...nodes.values()].reduce((sum, node) => sum + node.pr, 0)).toBeCloseTo(1, 8);
  });

  it("suggests a useful link for an observed under-linked page", () => {
    const nodes = new Map([
      ["https://example.com/guide-seo", {
        url: "https://example.com/guide-seo",
        outLinks: [],
        inLinks: ["https://example.com/"],
        pr: 0.6,
        clicks: 30,
      }],
      ["https://example.com/audit-seo", {
        url: "https://example.com/audit-seo",
        outLinks: [],
        inLinks: [],
        pr: 0.1,
        clicks: 0,
      }],
    ]);
    const suggestions = buildInternalLinkSuggestions(nodes);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toContain("audit-seo");
    expect(suggestions[0]).toContain("guide-seo");
  });
});
