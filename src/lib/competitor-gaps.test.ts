import { describe, expect, it } from "vitest";
import { sortGapsByKnownVolume, toGscOpportunities } from "@/lib/competitor-gaps";

describe("competitor gap data contract", () => {
  it("keeps GSC impressions separate from unknown search volume", () => {
    const [opportunity] = toGscOpportunities([
      { keyword: "investir etf suisse", our_position: 47.2, impressions: 234 },
    ]);

    expect(opportunity).toMatchObject({
      keyword: "investir etf suisse",
      our_position: 47.2,
      impressions: 234,
      volume: null,
      source: "gsc_opportunity",
    });
  });

  it("sorts cached rows without treating an unknown volume as zero data", () => {
    const sorted = sortGapsByKnownVolume([
      { keyword: "unknown", our_position: 45, competitor_positions: [], volume: null, source: "gsc_opportunity" },
      { keyword: "known", our_position: 55, competitor_positions: [], volume: 500, source: "competitor_cache" },
    ]);

    expect(sorted.map((row) => row.keyword)).toEqual(["known", "unknown"]);
  });
});
