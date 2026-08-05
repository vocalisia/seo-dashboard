import { describe, expect, it } from "vitest";
import { fetchResearchText } from "@/lib/web-research-fetch";
import { runWebResearch } from "@/lib/web-research";
import { buildPublicCompetitorResearch } from "@/lib/competitor-public-research";

const live = process.env.LIVE_WEB_RESEARCH === "1";

describe("live no-key web research", () => {
  it.runIf(live)("downloads a public page through the DNS-pinned fetch", async () => {
    const response = await fetchResearchText("https://example.com", {
      maxBytes: 100_000,
      timeoutMs: 15_000,
    });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Example Domain");
    expect(response.remote_address).toMatch(/[:.]/);
  }, 30_000);

  it.runIf(live)("returns real provider URLs with internally consistent evidence", async () => {
    const report = await runWebResearch("audit SEO technique suisse", {
      locale: "fr-FR",
      maxSources: 3,
    });
    expect(Object.values(report.search_providers)).toContain("ok");
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.sources.every((source) => /^https?:\/\//.test(source.url))).toBe(true);
    const sourceIds = new Set(report.sources.map((source) => source.id));
    expect(report.evidence.every((item) => sourceIds.has(item.source_id))).toBe(true);
    for (const item of report.evidence) {
      const source = report.sources.find((candidate) => candidate.id === item.source_id);
      expect(source?.fetch_status).toBe("ok");
      expect(source?.excerpt).toContain(item.claim);
    }
  }, 60_000);

  it.runIf(live)("extracts visible competitor terms without inventing volume or rank", async () => {
    const report = await runWebResearch("bourse suisse", {
      locale: "fr-FR",
      maxSources: 8,
    });
    const extracted = buildPublicCompetitorResearch(report, {
      ownDomain: "boursier.ch",
      ownKeywords: [],
    });
    expect(extracted.competitors.length).toBeGreaterThan(0);
    expect(extracted.gaps.length).toBeGreaterThan(0);
    expect(extracted.gaps.every((gap) =>
      gap.volume === 0 &&
      gap.competitor_position === 0 &&
      gap.source === "public_web" &&
      /^https?:\/\//.test(gap.source_url)
    )).toBe(true);
  }, 60_000);
});
