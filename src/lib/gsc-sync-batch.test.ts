import { describe, expect, it } from "vitest";
import {
  normalizePageLevelGscRows,
  normalizeQueryLevelGscRows,
} from "./gsc-sync-batch";

describe("GSC sync batch normalization", () => {
  it("normalizes page rows without inventing a missing date", () => {
    const rows = normalizePageLevelGscRows([
      { keys: ["audit seo", "https://example.ch/a", "2026-08-15"], clicks: 1.2, impressions: 9.7, ctr: 0.12, position: 8.5 },
      { keys: ["invalid", "https://example.ch/b", ""], position: 3 },
      { keys: ["too far", "https://example.ch/c", "2026-08-15"], position: 201 },
    ], { date: 2 });

    expect(rows).toEqual([{
      date: "2026-08-15",
      query: "audit seo",
      page: "https://example.ch/a",
      country: "",
      device: "",
      clicks: 1,
      impressions: 10,
      ctr: 0.12,
      position: 8.5,
    }]);
  });

  it("normalizes country and query-level rows", () => {
    expect(normalizePageLevelGscRows([
      { keys: ["audit seo", "https://example.ch/a", "che", "2026-08-15"], position: 4 },
    ], { date: 3, country: 2 })[0].country).toBe("CHE");

    expect(normalizeQueryLevelGscRows([
      { keys: ["  audit seo suisse  ", "che", "2026-08-15"], clicks: 2, impressions: 20, ctr: 0.1, position: 7 },
      { keys: ["", "che", "2026-08-15"], position: 7 },
    ])).toEqual([{
      date: "2026-08-15",
      query: "audit seo suisse",
      country: "CHE",
      device: "",
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 7,
    }]);
  });
});
