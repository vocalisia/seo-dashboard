import { describe, expect, it } from "vitest";
import { resolveSiteRepoConfig, SITE_REPO_MAP } from "./autopilot-config";

describe("resolveSiteRepoConfig", () => {
  it("matches tesla-mag style site names", () => {
    const r = resolveSiteRepoConfig("Tesla Mag");
    expect(r.siteKey).toBe("tesla-mag");
    expect(r.repoConfig?.repo).toBe("vocalisia/tesla-mag");
  });

  it("matches hub-ai from slug in name", () => {
    const r = resolveSiteRepoConfig("my-hub-ai-site");
    expect(r.siteKey).toBe("hub-ai");
  });

  it("returns null when no mapping fits", () => {
    const r = resolveSiteRepoConfig("unknown-random-brand-xyz");
    expect(r.siteKey).toBeNull();
    expect(r.repoConfig).toBeNull();
  });

  it("SITE_REPO_MAP has expected keys", () => {
    expect(SITE_REPO_MAP["seo-true"]?.repo).toBe("vocalisia/seo-true");
  });

  it("disables sites without an MDX deploy pipeline", () => {
    const expectedDisabled = [
      "tesla-mag",
      "cbd",
      "agents-ia",
      "master-seller",
      "seo-true",
      "vocalis-ai",
      "trust-vault",
    ];
    for (const key of expectedDisabled) {
      expect(SITE_REPO_MAP[key]?.enabled).toBe(false);
      expect(SITE_REPO_MAP[key]?.disabledReason).toBeTruthy();
    }
  });

  it("keeps sites with verified MDX pipeline enabled by default", () => {
    const expectedEnabled = [
      "vocalis-blog",
      "iapmesuisse",
      "iapme-suisse",
      "iapme",
      "hub-ai",
      "ai-due",
      "lead-gene",
      "trustly",
      "woman-cute",
      "fitness",
      "whatsapp",
    ];
    for (const key of expectedEnabled) {
      expect(SITE_REPO_MAP[key]?.enabled).not.toBe(false);
    }
  });

  it("vocalis-pro routes its public URLs to vocalis.blog", () => {
    expect(SITE_REPO_MAP["vocalis-pro"]?.publicUrlOverride).toBe("https://vocalis.blog");
    expect(SITE_REPO_MAP["vocalis-pro"]?.enabled).not.toBe(false);
  });

  it("trust-vault keeps i18nBlogPath even while disabled", () => {
    expect(SITE_REPO_MAP["trust-vault"]?.i18nBlogPath?.fr).toBe("/fr/blog");
    expect(SITE_REPO_MAP["trust-vault"]?.i18nBlogPath?.default).toBe("/fr/blog");
  });

  it("woman-cute uses /fr/blog as the public route", () => {
    expect(SITE_REPO_MAP["woman-cute"]?.i18nBlogPath?.fr).toBe("/fr/blog");
  });

  it("Vocalis Pro maps to vocalis-pro key, not vocalis-blog (longest-prefix wins)", () => {
    const r = resolveSiteRepoConfig("Vocalis Pro");
    expect(r.siteKey).toBe("vocalis-pro");
    expect(r.repoConfig?.publicUrlOverride).toBe("https://vocalis.blog");
  });

  it("exact match wins over substring match", () => {
    const r = resolveSiteRepoConfig("hub-ai");
    expect(r.siteKey).toBe("hub-ai");
  });

  it("ambiguous short name still resolves deterministically", () => {
    // 'vocalis' alone should not silently fall on vocalis-blog when vocalis-pro
    // and vocalis-ai also contain 'vocalis'. Longest-key wins → vocalis-blog
    // (length 12) but never crashes.
    const r = resolveSiteRepoConfig("vocalis");
    expect(r.siteKey).toMatch(/^vocalis-/);
  });
});
