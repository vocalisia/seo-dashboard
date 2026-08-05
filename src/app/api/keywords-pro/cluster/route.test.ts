import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth", () => ({ requireApiSession: vi.fn() }));

import { clusterKeywordsLocally } from "./route";

describe("local keyword clustering", () => {
  it("groups overlapping topics without an AI call", () => {
    const clusters = clusterKeywordsLocally([
      "audit seo technique",
      "audit seo complet",
      "assurance maladie suisse",
      "comparatif assurance suisse",
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.some((cluster) => cluster.keywords.includes("audit seo technique")
      && cluster.keywords.includes("audit seo complet"))).toBe(true);
  });

  it("deduplicates exact keywords", () => {
    expect(clusterKeywordsLocally(["audit seo", "audit seo"])[0].keywords).toEqual(["audit seo"]);
  });
});
