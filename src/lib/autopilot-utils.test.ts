import { describe, expect, it } from "vitest";
import { normalizeSeoTitle, slugify } from "./autopilot-utils";

describe("slugify", () => {
  it("removes accents and keeps stable hyphens", () => {
    expect(slugify("Facture impayée  Genève")).toBe("facture-impayee-geneve");
  });
});

describe("normalizeSeoTitle", () => {
  it("keeps a good short keyword-first title", () => {
    expect(normalizeSeoTitle("Pilier 3a en Suisse: erreurs à éviter", "pilier 3a en suisse")).toBe(
      "Pilier 3a en Suisse: erreurs à éviter"
    );
  });

  it("rewrites long generic titles into short keyword-first titles", () => {
    expect(
      normalizeSeoTitle(
        "The Ultimate Guide to pilier 3a en suisse for every profile in 2026",
        "pilier 3a en suisse"
      )
    ).toBe("Pilier 3a en suisse");
  });

  it("removes internal SEO labels and pricing junk", () => {
    expect(
      normalizeSeoTitle(
        "AIO / LLM SEO pilier 3a en suisse // 100% CHF",
        "pilier 3a en suisse"
      )
    ).toBe("Pilier 3a en suisse");
  });

  it("adds the keyword back when the proposed title misses it", () => {
    expect(
      normalizeSeoTitle("Comparatif complet pour indépendants et salariés", "grand 3a indépendant")
    ).toBe("Grand 3a indépendant");
  });
});
