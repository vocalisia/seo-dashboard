import { describe, expect, it } from "vitest";
import { buildFallbackClusters, parseAIClusters } from "./utils";

describe("keyword cluster helpers", () => {
  it("parses strict JSON responses", () => {
    expect(parseAIClusters('{"clusters":[{"name":"Voice AI","keywords":["voice ai"],"total_volume":100,"avg_position":8,"content_suggestion":"Build page","priority":"high"}]}')).toEqual({
      clusters: [
        {
          name: "Voice AI",
          keywords: ["voice ai"],
          total_volume: 100,
          avg_position: 8,
          content_suggestion: "Build page",
          priority: "high",
        },
      ],
    });
  });

  it("extracts JSON from markdown or prose", () => {
    const parsed = parseAIClusters(`
Here is the clustering:

\`\`\`json
{
  "clusters": [
    {
      "name": "Vocalis",
      "keywords": ["vocalis pro"],
      "total_volume": 42,
      "avg_position": 1,
      "content_suggestion": "Brand hub",
      "priority": "high"
    }
  ]
}
\`\`\`
`);

    expect(parsed?.clusters[0].name).toBe("Vocalis");
  });

  it("returns null for unusable AI output", () => {
    expect(parseAIClusters("I cannot provide JSON for this request.")).toBeNull();
  });

  it("builds deterministic fallback clusters from keyword stats", () => {
    const clusters = buildFallbackClusters([
      { query: "agent vocal ia", total_clicks: 3, total_impressions: 1200, avg_position: 12 },
      { query: "agent vocal pour restaurant", total_clicks: 1, total_impressions: 800, avg_position: 18 },
      { query: "standard telephonique ia", total_clicks: 0, total_impressions: 400, avg_position: 31 },
    ]);

    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].keywords.length).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(clusters[0].priority);
  });
});
