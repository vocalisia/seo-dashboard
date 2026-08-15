import { describe, expect, it } from "vitest";
import { extractPageSpeedMetrics } from "./pagespeed";

const lighthouseResult = {
  categories: { performance: { score: 0.91 } },
  audits: {
    "largest-contentful-paint": { numericValue: 2456 },
    "cumulative-layout-shift": { numericValue: 0.0846 },
    "first-contentful-paint": { numericValue: 1234 },
    "server-response-time": { numericValue: 456 },
    "interaction-to-next-paint": { numericValue: 178 },
  },
};

describe("PageSpeed metrics extraction", () => {
  it("reads the real Google response nested under lighthouseResult", () => {
    expect(extractPageSpeedMetrics({ lighthouseResult })).toEqual({
      score: 91,
      lcp: 2.456,
      cls: 0.085,
      fcp: 1.234,
      ttfb: 0.456,
      inp: 0.178,
    });
  });

  it("also accepts an already-unwrapped Lighthouse payload", () => {
    expect(extractPageSpeedMetrics(lighthouseResult).score).toBe(91);
  });

  it("returns explicit zeros when a metric is absent instead of NaN", () => {
    expect(extractPageSpeedMetrics({ lighthouseResult: { categories: {}, audits: {} } })).toEqual({
      score: 0,
      lcp: 0,
      cls: 0,
      fcp: 0,
      ttfb: 0,
      inp: 0,
    });
  });
});
