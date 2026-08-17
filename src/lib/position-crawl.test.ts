import { describe, expect, it } from "vitest";
import {
  chunkItems,
  crawlDateWindow,
  normalizeGscPositionRows,
  positionFreshness,
} from "./position-crawl";

describe("position crawl helpers", () => {
  it("normalizes query-level GSC rows without inventing missing positions", () => {
    const rows = normalizeGscPositionRows([
      {
        keys: [" audit seo suisse ", "che", "2026-08-05"],
        clicks: 2.4,
        impressions: 18.6,
        ctr: 0.129,
        position: 7.25,
      },
      { keys: ["", "che", "2026-08-05"], position: 3 },
      { keys: ["hors limite", "che", "2026-08-05"], position: 201 },
      { keys: ["date invalide", "che", "hier"], position: 8 },
    ]);

    expect(rows).toEqual([{
      date: "2026-08-05",
      query: "audit seo suisse",
      country: "CHE",
      clicks: 2,
      impressions: 19,
      ctr: 0.129,
      position: 7.25,
    }]);
  });

  it("paginates database upserts into bounded batches", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkItems([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("builds a final-data window ending two days before the run", () => {
    expect(crawlDateWindow(7, new Date("2026-08-08T12:00:00Z"))).toEqual({
      startDate: "2026-07-31",
      endDate: "2026-08-06",
    });
  });

  it("labels GSC freshness without treating an empty property as fresh", () => {
    const now = new Date("2026-08-08T12:00:00Z");
    expect(positionFreshness("2026-08-05", now)).toBe("fresh");
    expect(positionFreshness("2026-08-04", now)).toBe("stale");
    expect(positionFreshness("2026-07-20", now)).toBe("stale");
    expect(positionFreshness(null, now)).toBe("empty");
  });
});
