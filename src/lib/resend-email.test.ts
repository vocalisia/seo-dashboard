import { describe, expect, it } from "vitest";
import { resendFromAddress } from "./resend-email";

describe("Resend sender", () => {
  it("uses the verified portfolio sender by default", () => {
    expect(resendFromAddress("SEO Dashboard", {})).toBe(
      "SEO Dashboard <alerts@send.seo-true.com>",
    );
  });

  it("accepts a configured sender and strips header injection", () => {
    expect(resendFromAddress("SEO\r\nDashboard", {
      RESEND_FROM_EMAIL: "reports@send.seo-true.com\r\n",
    })).toBe("SEODashboard <reports@send.seo-true.com>");
  });

  it("falls back when the configured value is not an email", () => {
    expect(resendFromAddress("SEO Dashboard", {
      RESEND_FROM_EMAIL: "not-an-email",
    })).toBe("SEO Dashboard <alerts@send.seo-true.com>");
  });
});
