import { describe, expect, it } from "vitest";
import { classifyGA4AuditStatus } from "./ga4-audit";

describe("GA4 audit status", () => {
  it("does not claim a broken tag from zero imported sessions", () => {
    expect(classifyGA4AuditStatus("123456789", 0)).toBe("no_data");
  });

  it("distinguishes missing configuration from observed traffic", () => {
    expect(classifyGA4AuditStatus(null, 10)).toBe("not_configured");
    expect(classifyGA4AuditStatus("123456789", 42)).toBe("ok");
  });
});
