import { describe, expect, it } from "vitest";
import { assertSameSiteUrl, isPrivateOrReservedAddress, parsePublicHttpUrl } from "./safe-url";

describe("parsePublicHttpUrl", () => {
  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1",
    "http://192.168.1.1",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "https://example.com:8443/admin",
    "https://attacker.test/",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])("rejects unsafe URL %s", (raw) => {
    expect(() => parsePublicHttpUrl(raw)).toThrow();
  });

  it("accepts and normalizes public HTTP URLs", () => {
    expect(parsePublicHttpUrl("https://Example.com/page#section").toString()).toBe(
      "https://example.com/page",
    );
  });
});

describe("IP and sitemap boundaries", () => {
  it("recognizes reserved addresses", () => {
    expect(isPrivateOrReservedAddress("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedAddress("8.8.8.8")).toBe(false);
  });

  it("keeps sitemap pages on the requested site", () => {
    const site = new URL("https://example.com");
    expect(assertSameSiteUrl("https://www.example.com/page", site).hostname).toBe("www.example.com");
    expect(() => assertSameSiteUrl("https://attacker.test/page", site)).toThrow();
  });
});
