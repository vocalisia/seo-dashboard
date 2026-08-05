import { describe, expect, it } from "vitest";
import { isVerifiedBacklinkRow } from "@/lib/backlink-data";

describe("backlink data contract", () => {
  it("excludes legacy GSC visibility rows from backlink metrics", () => {
    expect(isVerifiedBacklinkRow({ linking_domain: "GSC visibility signal", target_page: "https://example.com/a", link_count: 100 })).toBe(false);
    expect(isVerifiedBacklinkRow({ linking_domain: "referrer.example", target_page: "https://example.com/a", link_count: 2 })).toBe(true);
  });
});
