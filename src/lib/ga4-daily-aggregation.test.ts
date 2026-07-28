import { describe, expect, it } from "vitest";
import { aggregateGa4Daily } from "./ga4-daily-aggregation";

describe("aggregateGa4Daily", () => {
  it("keeps non-additive users and ratios from the date-only report", () => {
    const result = aggregateGa4Daily(
      [{
        dimensionValues: [{ value: "20260727" }],
        metricValues: [
          { value: "100" }, { value: "70" }, { value: "20" },
          { value: "200" }, { value: "0.25" }, { value: "80" },
        ],
      }],
      [
        { dimensionValues: [{ value: "20260727" }, { value: "Organic Search" }], metricValues: [{ value: "40" }] },
        { dimensionValues: [{ value: "20260727" }, { value: "Direct" }], metricValues: [{ value: "30" }] },
        { dimensionValues: [{ value: "20260727" }, { value: "Organic Social" }], metricValues: [{ value: "10" }] },
      ],
    );

    expect(result.get("2026-07-27")).toMatchObject({
      sessions: 100,
      users: 70,
      newUsers: 20,
      bounceRate: 0.25,
      averageSessionDuration: 80,
      organic: 40,
      direct: 30,
      social: 10,
    });
  });
});