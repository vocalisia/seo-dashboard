import { describe, expect, it } from "vitest";
import { safeDashboardCallback } from "./login-form";

describe("safeDashboardCallback", () => {
  it("preserves an internal dashboard deep link", () => {
    expect(safeDashboardCallback("/positions?site=42")).toBe("/positions?site=42");
  });

  it("rejects external, protocol-relative and recursive login targets", () => {
    expect(safeDashboardCallback("https://evil.example/path")).toBe("/dashboard");
    expect(safeDashboardCallback("//evil.example/path")).toBe("/dashboard");
    expect(safeDashboardCallback("/login?callbackUrl=/positions")).toBe("/dashboard");
  });
});
