/**
 * Site → GitHub repo mapping and language targets for SEO autopilot.
 * i18nBlogPath: URL path prefix for blog articles (locale segment when applicable).
 */

export type SiteRepoConfig = {
  repo: string;
  articlePath: string;
  format: string;
  i18nBlogPath?: Record<string, string>;
};

export const SITE_REPO_MAP: Record<string, SiteRepoConfig> = {
  "vocalis-blog": {
    repo: "vocalisia/vocalis-blog",
    articlePath: "content/blog",
    format: "mdx",
  },
  "vocalis-pro": {
    repo: "vocalisia/vocalis-blog",
    articlePath: "content/blog",
    format: "mdx",
  },
  "tesla-mag": {
    repo: "vocalisia/tesla-mag",
    articlePath: "src/data/articles",
    format: "mdx",
    i18nBlogPath: { fr: "/produit", en: "/product", default: "/produit" },
  },
  "trust-vault": {
    repo: "vocalisia/trust-vault",
    articlePath: "content/posts",
    format: "mdx",
  },
  trustly: {
    repo: "vocalisia/trust-ai-blog",
    articlePath: "content/blog",
    format: "mdx",
  },
  iapmesuisse: {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog/fr",
    format: "md",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  "iapme-suisse": {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog/fr",
    format: "md",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  iapme: {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog/fr",
    format: "md",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  "hub-ai": {
    repo: "vocalisia/hub-ai",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  "ai-due": {
    repo: "vocalisia/hub-ai",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  "vocalis-ai": {
    repo: "vocalisia/vocalis-ai",
    articlePath: "content/blog",
    format: "mdx",
  },
  cbd: {
    repo: "vocalisia/cbd-europa",
    articlePath: "content/blog",
    format: "mdx",
  },
  "agents-ia": {
    repo: "vocalisia/agents-ia-pro",
    articlePath: "content/blog",
    format: "mdx",
  },
  "master-seller": {
    repo: "vocalisia/master-seller",
    articlePath: "content/blog",
    format: "mdx",
  },
  whatsapp: {
    repo: "vocalisia/agent-whatsapp-ia-business",
    articlePath: "content/blog",
    format: "mdx",
  },
  "lead-gene": {
    repo: "vocalisia/lead-gene",
    articlePath: "content/blog",
    format: "mdx",
  },
  "seo-true": {
    repo: "vocalisia/seo-true",
    articlePath: "content/blog",
    format: "mdx",
  },
  "woman-cute": {
    repo: "vocalisia/woman-cute",
    articlePath: "content/blog",
    format: "mdx",
  },
  fitness: {
    repo: "vocalisia/fitnessmaison",
    articlePath: "content/blog",
    format: "mdx",
  },
};

export type LangConfigEntry = {
  label: string;
  locale: string;
  serpLang: string;
  articleLang: string;
  countries: string[];
};

/** Label, locale, SERP language name, article language label, target countries (ISO-3) for GSC filtering */
export const LANG_CONFIG: Record<string, LangConfigEntry> = {
  fr: {
    label: "Français",
    locale: "fr-FR",
    serpLang: "French",
    articleLang: "français",
    countries: ["FRA", "BEL", "CHE", "LUX", "MCO", "CAN"],
  },
  en: {
    label: "English",
    locale: "en-US",
    serpLang: "English",
    articleLang: "English",
    countries: ["GBR", "USA", "IRL", "AUS", "NZL", "CAN"],
  },
  de: {
    label: "Deutsch",
    locale: "de-DE",
    serpLang: "German",
    articleLang: "Deutsch",
    countries: ["DEU", "AUT", "CHE", "LIE"],
  },
  es: {
    label: "Español",
    locale: "es-ES",
    serpLang: "Spanish",
    articleLang: "español",
    countries: ["ESP", "MEX", "ARG", "COL", "CHL", "PER"],
  },
  it: {
    label: "Italiano",
    locale: "it-IT",
    serpLang: "Italian",
    articleLang: "italiano",
    countries: ["ITA", "CHE", "SMR", "VAT"],
  },
  nl: {
    label: "Nederlands",
    locale: "nl-NL",
    serpLang: "Dutch",
    articleLang: "Nederlands",
    countries: ["NLD", "BEL"],
  },
  pt: {
    label: "Português",
    locale: "pt-PT",
    serpLang: "Portuguese",
    articleLang: "português",
    countries: ["PRT", "BRA", "AGO", "MOZ"],
  },
};

/** Match dashboard site name to repo config (same rules as autopilot route). */
export function resolveSiteRepoConfig(siteDisplayName: string): {
  normalizedSiteName: string;
  siteKey: string | null;
  repoConfig: SiteRepoConfig | null;
} {
  const normalizedSiteName = siteDisplayName.toLowerCase().replace(/[\s_]+/g, "-");
  const siteKey =
    Object.keys(SITE_REPO_MAP).find((k) => {
      const normK = k.toLowerCase();
      return normalizedSiteName.includes(normK) || normK.includes(normalizedSiteName);
    }) ?? null;
  return {
    normalizedSiteName,
    siteKey,
    repoConfig: siteKey ? SITE_REPO_MAP[siteKey] : null,
  };
}
