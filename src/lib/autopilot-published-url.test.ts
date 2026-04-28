import { describe, it, expect } from "vitest";
import {
  blogPathForLocale,
  buildPublishedArticleUrl,
  normalizeAutopilotMarkdownLinks,
} from "./autopilot-published-url";
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

  it("blogPathForLocale matches locale", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
      i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
    };
    expect(blogPathForLocale(cfg, "fr")).toBe("/fr/blog");
    expect(blogPathForLocale(cfg, "en")).toBe("/en/blog");
    expect(blogPathForLocale(null, "fr")).toBe("/blog");
  });

  it("respects publicUrlOverride when present", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
      publicUrlOverride: "https://vocalis.blog",
    };
    expect(buildPublishedArticleUrl("https://vocalis.pro", "voice ai", "fr", cfg, d)).toBe(
      `https://vocalis.blog/blog/voice-ai-${d}`
    );
  });

  it("normalizeAutopilotMarkdownLinks adds leading slash for locale paths", () => {
    const cfg: SiteRepoConfig = {
      repo: "x/y",
      articlePath: "content/blog",
      format: "mdx",
      i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
    };
    const raw =
      "Voir [autre](fr/blog/foo-bar-2026-01-01) et [legacy](blog/baz-2026-02-02).";
    const out = normalizeAutopilotMarkdownLinks(raw, "fr", cfg);
    expect(out).toContain("](/fr/blog/foo-bar-2026-01-01)");
    expect(out).toContain("](/fr/blog/baz-2026-02-02)");
  });
});
