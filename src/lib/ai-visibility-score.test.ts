import { describe, expect, it } from "vitest";
import { calculateVisibilityScore } from "./ai-visibility-score";

describe("AI visibility score", () => {
  it("excludes unavailable measurements instead of counting false negatives", () => {
    expect(calculateVisibilityScore([
      { measured: true, mentioned: true },
      { measured: true, mentioned: false },
      { measured: false, mentioned: false },
    ])).toEqual({ score: 50, measured: 2, requested: 3, mentions: 1 });
  });

  it("returns an unknown score when nothing was measured", () => {
    expect(calculateVisibilityScore([{ measured: false, mentioned: false }]).score).toBeNull();
  });
});
