import { describe, expect, it } from "vitest";
import {
  resolveSiteRepoConfig,
  SITE_REPO_MAP,
  isPublishBlockedByDomain,
} from "./autopilot-config";

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
      "fitness",
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

  it("resolves accented site names (factureimpayée → factureimpayee)", () => {
    const r1 = resolveSiteRepoConfig("factureimpayée");
    expect(r1.siteKey).toBe("factureimpayee");
    expect(r1.repoConfig?.enabled).toBe(false);

    const r2 = resolveSiteRepoConfig("Facture Impayée");
    expect(r2.siteKey).toBe("facture-impayee");
    expect(r2.repoConfig?.enabled).toBe(false);
  });

  it("resolves tesla-mag variants to disabled config (zero 404 risk)", () => {
    const variants = [
      "tesla-mag",
      "Tesla Mag",
      "Tesla-Mag",
      "tesla-mag.ch",
      "tesla.mag",
      "TeslaMag",
      "teslamag",
      "Tesla_Mag",
      "TESLA MAG",
    ];
    for (const name of variants) {
      const r = resolveSiteRepoConfig(name);
      expect(r.siteKey, `failed for: ${name}`).toBe("tesla-mag");
      expect(r.repoConfig?.enabled, `enabled for: ${name}`).toBe(false);
    }
  });

  it("isPublishBlockedByDomain blocks all known-disabled domains (defense in depth)", () => {
    const blocked = [
      "https://tesla-mag.ch",
      "https://www.tesla-mag.ch",
      "https://tesla-mag.ch/produit",
      "https://master-seller.fr",
      "https://www.master-seller.fr/blog",
      "https://seo-true.com",
      "https://trust-vault.com/fr/blog",
      "https://cbdeuropa.com",
      "https://agents-ia.pro",
      "https://vocalis-ai.org",
      "https://factureimpayée.fr",
      "https://factureimpayee.fr",
      "https://xn--factureimpaye-mhb.fr",
    ];
    for (const url of blocked) {
      expect(isPublishBlockedByDomain(url), `should block: ${url}`).toBe(true);
    }
    const allowed = [
      "https://vocalis.blog",
      "https://trustly-ai.com",
      "https://ai-due.com",
      "https://lead-gene.com",
      "https://iapmesuisse.ch",
      "https://agentic-whatsup.com",
      "https://woman-cute.com",
    ];
    for (const url of allowed) {
      expect(isPublishBlockedByDomain(url), `should NOT block: ${url}`).toBe(false);
    }
  });

  it("resolves all disabled domain variants to disabled config", () => {
    const cases: Array<[string, string]> = [
      ["seo-true.com", "seo-true"],
      ["SEOTrue", "seo-true"],
      ["trust-vault.com", "trust-vault"],
      ["TrustVault", "trust-vault"],
      ["cbdeuropa.com", "cbd"],
      ["agents-ia.pro", "agents-ia"],
      ["AgentsIA", "agents-ia"],
      ["master-seller.fr", "master-seller"],
      ["MasterSeller", "master-seller"],
      ["vocalis-ai.org", "vocalis-ai"],
      ["VocalisAI", "vocalis-ai"],
    ];
    for (const [input, expectedKey] of cases) {
      const r = resolveSiteRepoConfig(input);
      expect(r.siteKey, `wrong key for: ${input}`).toBe(expectedKey);
      expect(r.repoConfig?.enabled, `not disabled for: ${input}`).toBe(false);
    }
  });
});
