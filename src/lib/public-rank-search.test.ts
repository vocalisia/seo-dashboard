import { describe, expect, it } from "vitest";
import { mapPublicRankResults, publicRankLocale } from "./public-rank-search";

describe("public rank search", () => {
  it("selects a transparent locale for the requested market", () => {
    expect(publicRankLocale("CH")).toBe("fr-CH");
    expect(publicRankLocale("GB")).toBe("en-GB");
    expect(publicRankLocale("invalid")).toBe("fr-FR");
  });

  it("maps merged public web results to a bounded rank snapshot", () => {
    const results = mapPublicRankResults([{
      url: "https://www.example.ch/page",
      domain: "www.example.ch",
      title: "Example",
      snippet: "Evidence",
      providers: ["bing_rss"],
      positions: { bing_rss: 2 },
    }]);

    expect(results).toEqual([{
      position: 1,
      url: "https://www.example.ch/page",
      title: "Example",
      description: "Evidence",
      domain: "example.ch",
    }]);
  });
});
