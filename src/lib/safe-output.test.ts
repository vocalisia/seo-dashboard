import { describe, expect, it } from "vitest";
import { escapeHtml, safeHttpHref } from "./safe-output";

describe("safe output", () => {
  it("escapes user-controlled HTML for email templates", () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it("allows only http(s) hrefs", () => {
    expect(safeHttpHref("https://example.test/article")).toBe("https://example.test/article");
    expect(safeHttpHref("javascript:alert(1)")).toBeNull();
  });
});