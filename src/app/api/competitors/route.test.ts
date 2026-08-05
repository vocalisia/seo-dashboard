import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runWebResearch: vi.fn(),
  askAI: vi.fn(),
}));

vi.mock("@/lib/web-research", () => ({ runWebResearch: mocks.runWebResearch }));
vi.mock("@/lib/ai", () => ({
  askAI: mocks.askAI,
  AIProviderError: class AIProviderError extends Error {},
}));
vi.mock("@/lib/api-auth", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { runResearchForSite } from "./route";

describe("competitor research without API", () => {
  it("extracts public terms and never calls the legacy AI provider", async () => {
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const text = Array.from(strings).join("?");
      if (text.includes("FROM search_console_query_data")) {
        return Promise.resolve([{ query: "bourse suisse" }, { query: "actions suisses" }]);
      }
      if (text.includes("SELECT url FROM sites")) {
        return Promise.resolve([{ url: "https://boursier.ch" }]);
      }
      return Promise.resolve([]);
    });
    mocks.runWebResearch.mockResolvedValueOnce({
      query: "bourse suisse",
      locale: "fr-FR",
      generated_at: "2026-08-05T10:00:00.000Z",
      data_status: "complete",
      search_providers: { bing_rss: "ok", duckduckgo_html: "ok" },
      answer: "",
      evidence: [],
      sources: [
        {
          id: "S1",
          url: "https://cash.ch/marches",
          domain: "cash.ch",
          title: "Marchés et bourse suisse | cash.ch",
          snippet: "",
          providers: ["bing_rss"],
          positions: { bing_rss: 1 },
          fetch_status: "ok",
          description: "Actualité financière suisse",
          headings: ["Actions suisses à surveiller", "Prévisions du marché"],
          schema_types: [],
          word_count: 500,
          excerpt: "Extrait",
        },
        {
          id: "S2",
          url: "https://zonebourse.com/suisse",
          domain: "zonebourse.com",
          title: "Meilleures actions suisses",
          snippet: "",
          providers: ["duckduckgo_html"],
          positions: { duckduckgo_html: 2 },
          fetch_status: "ok",
          description: "Analyse financière",
          headings: ["Analyse technique du SMI"],
          schema_types: [],
          word_count: 400,
          excerpt: "Extrait",
        },
      ],
    });

    const result = await runResearchForSite(
      { id: 7, name: "Boursier.ch", url: "https://boursier.ch" },
      sql as never,
    );

    expect(mocks.runWebResearch).toHaveBeenCalledWith("bourse suisse", { locale: "fr-FR", maxSources: 8 });
    expect(mocks.askAI).not.toHaveBeenCalled();
    expect(result.competitors.map((item) => item.domain).sort()).toEqual(["cash.ch", "zonebourse.com"]);
    expect(result.gaps.length).toBeGreaterThanOrEqual(3);
    expect(result.gaps.every((gap) =>
      gap.source === "public_web" &&
      gap.volume === 0 &&
      gap.competitor_position === 0
    )).toBe(true);
  });
});
