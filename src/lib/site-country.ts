/**
 * site-country.ts — single source of truth: TLD → country code (ISO-3).
 *
 * Per user policy:
 *   .ch  → CHE
 *   .be  → BEL
 *   .ca  → CAN
 *   .fr / .com / .net / .org / .pro / .blog / .ai / .org / xn--…fr → FRA
 *
 * IDN (punycode) domains keep the *real* TLD: e.g. xn--factureimpaye-mhb.fr → FRA.
 */

export function siteCountryCode(siteUrl: string | null | undefined): string {
  if (!siteUrl) return "FRA";

  // Extract host from URL (handles "https://x.fr", "x.fr", "sc-domain:x.fr"...)
  let host = siteUrl.toLowerCase().trim();
  host = host.replace(/^sc-domain:/, "");
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    // not a URL — treat as host
  }
  host = host.replace(/^www\./, "").replace(/\/+$/, "");

  // TLD = last dot segment, regardless of punycode in earlier segments
  const tld = host.split(".").pop() || "";

  if (tld === "ch") return "CHE";
  if (tld === "be") return "BEL";
  if (tld === "ca") return "CAN";
  // .fr, .com, .net, .org, .pro, .blog, .ai, .io, .dev, etc. — default FR market
  return "FRA";
}

/**
 * Return SQL filter array for a site: primary country + NULL fallback so that
 * rows without a recorded country are not silently dropped.
 *
 * Used as: WHERE (country = $1 OR country IS NULL)
 */
export function siteCountryFilter(siteUrl: string | null | undefined): string {
  return siteCountryCode(siteUrl);
}

/**
 * Keyword-volume markets to keep for a site.
 * .ch projects need Swiss demand plus French demand because French keywords can
 * exist in both markets with very different volumes.
 */
export function siteKeywordMarkets(siteUrl: string | null | undefined): string[] {
  const country = siteCountryCode(siteUrl);
  if (country === "CHE") return ["CH", "FR"];
  if (country === "BEL") return ["BE", "FR"];
  if (country === "CAN") return ["CA", "FR"];
  return ["FR"];
}

export function primaryKeywordMarket(siteUrl: string | null | undefined): string {
  return siteKeywordMarkets(siteUrl)[0] ?? "FR";
}
