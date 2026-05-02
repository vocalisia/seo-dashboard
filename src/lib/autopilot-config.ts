/**
 * Site → GitHub repo mapping and language targets for SEO autopilot.
 * i18nBlogPath: URL path prefix for blog articles (locale segment when applicable).
 */

export type SiteRepoConfig = {
  repo: string;
  articlePath: string;
  format: string;
  i18nBlogPath?: Record<string, string>;
  /**
   * Si false, l'autopilot n'écrit rien : le repo n'est pas la source de
   * déploiement du site public, ou le site n'a pas de pipeline MDX → toute
   * publication fabriquerait des URLs 404. `disabledReason` est remontée à l'UI.
   */
  enabled?: boolean;
  disabledReason?: string;
  /**
   * Override l'URL publique utilisée pour `published_url`. Utile quand un site
   * partage un repo avec un autre domaine (ex. vocalis.pro publie via le repo
   * vocalis-blog → contenu rendu sur vocalis.blog).
   */
  publicUrlOverride?: string;
  /** Si true, le slug n'inclut PAS le suffixe date (ex: trustly-ai utilise slug brut sans -YYYY-MM-DD) */
  noDateSuffix?: boolean;
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
    publicUrlOverride: "https://vocalis.blog",
  },
  "tesla-mag": {
    repo: "vocalisia/tesla-mag",
    articlePath: "src/data/articles",
    format: "mdx",
    i18nBlogPath: { fr: "/produit", en: "/product", default: "/produit" },
    enabled: false,
    disabledReason:
      "tesla-mag.ch est sur WordPress Infomaniak avec pipeline Make.com (RSS → ChatGPT → WP). Le repo GitHub n'est pas la source de production.",
  },
  "trust-vault": {
    repo: "vocalisia/trust-vault",
    articlePath: "content/posts",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  trustly: {
    repo: "vocalisia/trust-ai-blog",
    articlePath: "content/blog",
    format: "mdx",
    noDateSuffix: true,
    i18nBlogPath: { fr: "/blog", en: "/blog", default: "/blog" },
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
    enabled: false,
    disabledReason:
      "vocalis-ai.org est une ancienne version archivée. Le repo vocalisia/vocalis-ai ne reflète plus le déploiement public (sitemap a 600+ URLs, repo en a 1).",
  },
  cbd: {
    repo: "vocalisia/cbd-europa",
    articlePath: "content/blog",
    format: "mdx",
    enabled: false,
    disabledReason:
      "cbdeuropa.com n'a pas de route /blog rendue (sitemap = 5 URLs, 0 article). Pas de pipeline MDX déployé.",
  },
  "agents-ia": {
    repo: "vocalisia/agents-ia-pro",
    articlePath: "content/blog",
    format: "mdx",
    enabled: false,
    disabledReason:
      "agents-ia.pro sert des fichiers HTML statiques (.html dans le sitemap). Le repo vocalisia/agents-ia-pro n'est pas le source de déploiement effectif du blog.",
  },
  "master-seller": {
    repo: "vocalisia/master-seller",
    articlePath: "content/blog",
    format: "mdx",
    enabled: false,
    disabledReason:
      "master-seller.fr est servi en HTML+Tailwind+VanillaJS (sans pipeline MDX). Les MDX poussés ne sont jamais rendus → 404.",
  },
  whatsapp: {
    repo: "vocalisia/agent-whatsapp-ia-business",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  "lead-gene": {
    repo: "vocalisia/lead-gene",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: {
      fr: "/fr/blog",
      en: "/en/blog",
      de: "/de/blog",
      nl: "/nl/blog",
      default: "/fr/blog",
    },
  },
  "seo-true": {
    repo: "vocalisia/seo-true",
    articlePath: "content/blog",
    format: "mdx",
    enabled: false,
    disabledReason:
      "seo-true.com est servi en HTML statique depuis public/index.html — pas de pipeline MDX déployé. Les fichiers MDX du repo n'arrivent jamais en prod.",
  },
  "woman-cute": {
    repo: "vocalisia/woman-cute",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", default: "/fr/blog" },
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
  const keys = Object.keys(SITE_REPO_MAP);

  // 1. Match exact (vocalis-pro → "vocalis-pro" pas "vocalis-blog")
  let siteKey: string | null =
    keys.find((k) => k.toLowerCase() === normalizedSiteName) ?? null;

  // 2. Sinon match prefix par clé la plus longue (évite "vocalis" → "vocalis-blog"
  // quand "vocalis-pro" existe). Trier par longueur décroissante.
  if (!siteKey) {
    siteKey =
      keys
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const normK = k.toLowerCase();
          return normalizedSiteName.includes(normK) || normK.includes(normalizedSiteName);
        }) ?? null;
  }

  return {
    normalizedSiteName,
    siteKey,
    repoConfig: siteKey ? SITE_REPO_MAP[siteKey] : null,
  };
}
