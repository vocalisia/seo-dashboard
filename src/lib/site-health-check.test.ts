import { describe, expect, it } from "vitest";
import { analyzeGA4, analyzeSEO } from "./site-health-check";

describe("analyzeGA4", () => {
  it("detects missing GA4 + GTM as critical", () => {
    const html = "<html><head></head><body></body></html>";
    const r = analyzeGA4(html);
    expect(r.ga4_id).toBeNull();
    expect(r.issues.some((i) => i.code === "ga4_missing")).toBe(true);
  });

  it("accepts GTM container alone (no GA4 ID) without flagging missing", () => {
    const html = `<html><head><script>(function(w,d,s,l,i){w[l]=w[l]||[];})(window,document,'script','dataLayer','GTM-ABC1234');</script></head></html>`;
    const r = analyzeGA4(html);
    expect(r.issues.some((i) => i.code === "ga4_missing")).toBe(false);
  });

  it("detects GA4 without consent mode", () => {
    const html = `<html><head><script src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234"></script><script>gtag('config','G-ABCDEF1234')</script></head></html>`;
    const r = analyzeGA4(html);
    expect(r.ga4_id).toBe("G-ABCDEF1234");
    expect(r.has_consent_mode).toBe(false);
    expect(r.issues.some((i) => i.code === "ga4_no_consent_mode")).toBe(true);
  });

  it("detects consent AFTER gtag.js load", () => {
    const html =
      `<script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ12345"></script>` +
      "x".repeat(50) +
      `<script>gtag('consent','default',{ad_storage:'denied'})</script>`;
    const r = analyzeGA4(html);
    expect(r.has_consent_mode).toBe(true);
    expect(r.issues.some((i) => i.code === "ga4_consent_after_init")).toBe(true);
  });

  it("detects inverted consent logic", () => {
    const html =
      `<script>gtag('consent','default',{analytics_storage: rejected ? 'granted' : 'denied'})</script>` +
      `<script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ12345"></script>`;
    const r = analyzeGA4(html);
    expect(r.issues.some((i) => i.code === "ga4_consent_inverted")).toBe(true);
  });

  it("detects duplicate gtag.js snippets", () => {
    const html =
      `<script>gtag('consent','default',{ad_storage:'denied'})</script>` +
      `<script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ12345"></script>` +
      `<script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ12345"></script>`;
    const r = analyzeGA4(html);
    expect(r.issues.some((i) => i.code === "ga4_duplicate_snippet")).toBe(true);
  });

  it("clean install passes (consent before init, single snippet)", () => {
    const html =
      `<script>gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied'})</script>` +
      `<script src="https://www.googletagmanager.com/gtag/js?id=G-CLEAN1234"></script>` +
      `<script>gtag('config','G-CLEAN1234')</script>`;
    const r = analyzeGA4(html);
    expect(r.ga4_id).toBe("G-CLEAN1234");
    expect(r.has_consent_mode).toBe(true);
    expect(r.issues.filter((i) => i.severity === "critical")).toHaveLength(0);
  });
});

describe("analyzeSEO", () => {
  it("flags noindex meta as critical", () => {
    const html = `<html><head><meta name="robots" content="noindex,follow"></head></html>`;
    const r = analyzeSEO(html);
    expect(r.issues.some((i) => i.code === "noindex_meta")).toBe(true);
  });

  it("flags duplicate canonical as critical", () => {
    const html = `<html><head><link rel="canonical" href="https://a.com"><link rel="canonical" href="https://b.com"></head></html>`;
    const r = analyzeSEO(html);
    expect(r.issues.some((i) => i.code === "duplicate_canonical")).toBe(true);
  });

  it("flags missing H1 + missing canonical + missing html lang", () => {
    const html = `<html><head><title>X</title></head><body><h2>nope</h2></body></html>`;
    const r = analyzeSEO(html);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("no_h1");
    expect(codes).toContain("no_canonical");
    expect(codes).toContain("no_html_lang");
  });

  it("flags broken JSON-LD parse", () => {
    const html = `<html lang="fr"><head><script type="application/ld+json">{not valid json</script></head><body><h1>x</h1></body></html>`;
    const r = analyzeSEO(html);
    expect(r.has_schema_jsonld).toBe(true);
    expect(r.issues.some((i) => i.code === "broken_jsonld")).toBe(true);
  });

  it("clean install passes all checks", () => {
    const html =
      `<html lang="fr"><head>` +
      `<title>Un titre normal et bien dosé pour SEO</title>` +
      `<meta name="description" content="${"a".repeat(120)}">` +
      `<link rel="canonical" href="https://example.com/">` +
      `<meta property="og:title" content="x">` +
      `<meta property="og:image" content="https://example.com/og.png">` +
      `<meta property="og:type" content="website">` +
      `<meta property="og:url" content="https://example.com/">` +
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>` +
      `</head><body><h1>Title</h1></body></html>`;
    const r = analyzeSEO(html);
    expect(r.issues.filter((i) => i.severity === "critical" || i.severity === "high")).toHaveLength(0);
  });
});
