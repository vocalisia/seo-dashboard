import { describe, expect, it } from "vitest";
import { isVerifiedKeywordVolumeSource, resolveVerifiedKeywordVolume } from "./keyword-volume";

describe("verified keyword volumes", () => {
  it("accepts identified planner providers only", () => {
    expect(isVerifiedKeywordVolumeSource("google_kp_real_plan_ch")).toBe(true);
    expect(isVerifiedKeywordVolumeSource("keyword_planner_import")).toBe(true);
    expect(isVerifiedKeywordVolumeSource("dashboard_estimate")).toBe(false);
    expect(isVerifiedKeywordVolumeSource("niche_skip")).toBe(false);
  });

  it("uses the largest usable market value and rejects unsourced numbers", () => {
    expect(resolveVerifiedKeywordVolume("keyword_planner_import", 0, 120, 90)).toBe(120);
    expect(resolveVerifiedKeywordVolume("dashboard_estimate", 800)).toBe(0);
  });
});
