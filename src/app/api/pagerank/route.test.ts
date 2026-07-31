import { describe, expect, it } from "vitest";
import { computePageRank, extractInternalLinks, normalizeUrlForGraph } from "@/lib/pagerank-graph";

describe("PageRank graph helpers", () => {
  it("normalizes canonical graph URLs and parses both quote styles", () => {
    expect(normalizeUrlForGraph("https://www.example.com/path/")).toBe("https://example.com/path");

    const links = extractInternalLinks(
      `<a href='/guide/'>Guide</a><a href="/contact">Contact</a><a href="https://other.example/x">Off-site</a><a href="/image.png">Image</a>`,
      "example.com",
    );

    expect(links).toEqual(["https://example.com/guide", "https://example.com/contact"]);
  });

  it("assigns more PageRank to a page with more observed inbound links", () => {
    const nodes = new Map([
      ["https://example.com/", { url: "https://example.com/", outLinks: ["https://example.com/guide", "https://example.com/contact"], inLinks: [], pr: 0, clicks: 0 }],
      ["https://example.com/guide", { url: "https://example.com/guide", outLinks: ["https://example.com/"], inLinks: [], pr: 0, clicks: 0 }],
      ["https://example.com/contact", { url: "https://example.com/contact", outLinks: ["https://example.com/"], inLinks: [], pr: 0, clicks: 0 }],
    ]);

    computePageRank(nodes, 50, 0.85);

    expect(nodes.get("https://example.com/")!.pr).toBeGreaterThan(nodes.get("https://example.com/guide")!.pr);
  });
});
