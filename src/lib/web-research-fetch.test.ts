import { describe, expect, it } from "vitest";
import {
  createResearchPinnedLookup,
  isResearchBlockedAddress,
  parseResearchPublicUrl,
  resolveResearchUrl,
} from "@/lib/web-research-fetch";

describe("research URL security", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::ffff:127.0.0.1]/",
    "https://example.com:444/",
    "https://single-label/",
    "https://service.internal/",
  ])("rejects unsafe research target %s", (raw) => {
    expect(() => parseResearchPublicUrl(raw)).toThrow();
  });

  it("recognizes mapped, private, documentation, and public addresses", () => {
    expect(isResearchBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isResearchBlockedAddress("10.0.0.1")).toBe(true);
    expect(isResearchBlockedAddress("2001:db8::1")).toBe(true);
    expect(isResearchBlockedAddress("8.8.8.8")).toBe(false);
    expect(isResearchBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects mixed public and private DNS answers", async () => {
    await expect(resolveResearchUrl("https://example.com", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])).rejects.toThrow("private or reserved");
  });

  it("pins the connector to the validated DNS answer", async () => {
    const lookup = createResearchPinnedLookup({ address: "93.184.216.34", family: 4 });
    const result = await new Promise<{ address: string; family?: number }>((resolve, reject) => {
      lookup("changed-after-validation.example", { all: false }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address: String(address), family });
      });
    });
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });
});
