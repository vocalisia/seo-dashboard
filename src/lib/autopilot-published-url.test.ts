import { describe, it, expect } from "vitest";
import { buildPublishedArticleUrl } from "./autopilot-published-url";
import type { SiteRepoConfig } from "./autopilot-config";

describe("buildPublishedArticleUrl", () => {
  const d = "2026-04-14";

  it("uses /blog, FR, and date suffix like frontmatter slug", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
    };
    expect(buildPublishedArticleUrl("https://example.com/", "voice ai", "fr", cfg, d)).toBe(
      `https://example.com/blog/voice-ai-${d}`
    );
  });

  it("uses i18n blog path and date suffix", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
      i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
    };
    expect(buildPublishedArticleUrl("https://hub.test", "cbd oil", "fr", cfg, d)).toBe(
      `https://hub.test/fr/blog/cbd-oil-${d}`
    );
  });
});
