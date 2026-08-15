import { describe, expect, it } from "vitest";
import { runOutcome } from "./run-outcome";

describe("run outcome", () => {
  it("distinguishes complete, partial, failed and empty runs", () => {
    expect(runOutcome(3, 0)).toEqual({ success: true, partial: false, skipped: false, statusCode: 200 });
    expect(runOutcome(2, 1)).toEqual({ success: true, partial: true, skipped: false, statusCode: 207 });
    expect(runOutcome(0, 3)).toEqual({ success: false, partial: false, skipped: false, statusCode: 502 });
    expect(runOutcome(0, 0, 0)).toEqual({ success: true, partial: false, skipped: true, statusCode: 200 });
  });
});
