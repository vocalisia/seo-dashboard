import { describe, expect, it } from "vitest";
import {
  isUnusableSeoKeyword,
  pickFirstUsableKeyword,
  type KeywordRow,
} from "./autopilot-keywords";

const genericSite = { url: "https://example.com", name: "Example Studio" };

describe("isUnusableSeoKeyword", () => {
  it("rejects Google operator-style queries", () => {
    expect(isUnusableSeoKeyword("site:competitor.com something", genericSite)).toBe(true);
    expect(isUnusableSeoKeyword('inurl:"admin" login', genericSite)).toBe(true);
  });

  it("rejects URL-like queries", () => {
    expect(isUnusableSeoKeyword("https://shop.example.com/p/123", genericSite)).toBe(true);
    expect(isUnusableSeoKeyword("visit www.other-brand.io today", genericSite)).toBe(true);
  });

  it("rejects too-short queries", () => {
    expect(isUnusableSeoKeyword("ab", genericSite)).toBe(true);
  });

  it("rejects pure numbers", () => {
    expect(isUnusableSeoKeyword("2024", genericSite)).toBe(true);
  });

  it("accepts solid informational queries", () => {
    expect(
      isUnusableSeoKeyword(
        "comment optimiser le référencement local pour une pme",
        genericSite,
        "fr"
      )
    ).toBe(false);
    expect(
      isUnusableSeoKeyword("how to improve core web vitals for ecommerce", genericSite, "en")
    ).toBe(false);
  });

  it("flags strong cross-language mismatch vs article language (DE indicators for FR article)", () => {
    const q = "der die automatisierung verkauf";
    expect(isUnusableSeoKeyword(q, genericSite, "fr")).toBe(true);
  });

  it("does not treat common English tokens as conflict for non-English article targets", () => {
    expect(
      isUnusableSeoKeyword("the best guide to seo for small business", genericSite, "fr")
    ).toBe(false);
  });

  it("uses hostname for brand hints (rejects navigational single-token)", () => {
    const site = { url: "https://www.acmestudio.io", name: "Acme Studio" };
    expect(isUnusableSeoKeyword("acmestudio", site, "en")).toBe(true);
  });

  it("flags Italian-heavy query for German article target", () => {
    const q = "come nella automazione aziendale intelligenza artificiale";
    expect(isUnusableSeoKeyword(q, genericSite, "de")).toBe(true);
  });

  it("accepts query aligned with German article target", () => {
    expect(
      isUnusableSeoKeyword(
        "marketing automatisierung für kleine unternehmen tipps",
        genericSite,
        "de"
      )
    ).toBe(false);
  });
});

describe("pickFirstUsableKeyword", () => {
  const site = genericSite;

  it("skips bad rows and returns the first usable keyword", () => {
    const rows: KeywordRow[] = [
      { query: "site:spam.test", position: "1", impressions: "100", clicks: "0" },
      { query: "stratégie contenu b2b durable", position: "12", impressions: "80", clicks: "1" },
    ];
    expect(pickFirstUsableKeyword(rows, site, "fr")).toEqual([rows[1]]);
  });

  it("returns empty array when nothing passes filters", () => {
    const rows: KeywordRow[] = [
      { query: "x", position: "1", impressions: "1", clicks: "0" },
      { query: "site:yahoo.com", position: "2", impressions: "2", clicks: "0" },
    ];
    expect(pickFirstUsableKeyword(rows, site, "fr")).toEqual([]);
  });

  it("respects language when picking first usable row", () => {
    const rows: KeywordRow[] = [
      { query: "come nella automazione", position: "5", impressions: "100", clicks: "1" },
      { query: "local seo checklist", position: "10", impressions: "50", clicks: "2" },
    ];
    expect(pickFirstUsableKeyword(rows, site, "de")).toEqual([rows[1]]);
  });
});
