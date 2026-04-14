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
});
