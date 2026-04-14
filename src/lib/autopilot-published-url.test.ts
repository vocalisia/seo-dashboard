import { describe, it, expect } from "vitest";
import { buildPublishedArticleUrl } from "./autopilot-published-url";
import type { SiteRepoConfig } from "./autopilot-config";

describe("buildPublishedArticleUrl", () => {
  it("uses /blog and no prefix for FR when no i18n", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
    };
    expect(buildPublishedArticleUrl("https://example.com/", "voice ai", "fr", cfg)).toBe(
      "https://example.com/blog/voice-ai"
    );
  });

  it("uses i18n blog path without lang slug prefix", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
      i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
    };
    expect(buildPublishedArticleUrl("https://hub.test", "cbd oil", "fr", cfg)).toBe(
      "https://hub.test/fr/blog/cbd-oil"
    );
  });
});
