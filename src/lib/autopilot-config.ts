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

/**
 * Domaines absolument interdits à la publication autopilot, quelle que soit
 * la résolution `resolveSiteRepoConfig`. Garde-fou final pour éviter qu'un
 * nom de site mal normalisé en DB déclenche une publication 404.
 * Ces domaines sont gérés ailleurs (WordPress externe, HTML statique, etc.).
 */
export const BLOCKED_PUBLISH_DOMAINS: ReadonlyArray<string> = [
  "tesla-mag.ch",
  "tesla-mag.ca",
  "master-seller.fr",
  "seo-true.com",
  "trust-vault.com",
  "cbdeuropa.com",
  "agents-ia.pro",
  "vocalis-ai.org",
  "fitnessmaison.fr",
  "factureimpayee.fr",
  "factureimpayée.fr",
  "xn--factureimpaye-mhb.fr",
];

/** Returns true if siteUrl matches a blocked domain (host comparison, case-insensitive). */
export function isPublishBlockedByDomain(siteUrl: string): boolean {
  let host: string;
  try {
    host = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    host = siteUrl.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
  host = host.replace(/^www\./, "");
  return BLOCKED_PUBLISH_DOMAINS.some((d) => {
    const blocked = d.toLowerCase().replace(/^www\./, "");
    return host === blocked || host.endsWith("." + blocked);
  });
}

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
  "tesla-mag-ca": {
    repo: "vocalisia/tesla-mag-ca",
    articlePath: "src/data/articles.ts",
    format: "mdx",
    i18nBlogPath: { fr: "/article", en: "/en/article", default: "/article" },
    enabled: false,
    disabledReason:
      "tesla-mag.ca stocke les articles dans un tableau TypeScript (src/data/articles.ts), pas en MDX. Pipeline autopilot MDX incompatible — tracking GSC/GA4 OK, publication désactivée.",
  },
  "tesla-mag.ca": {
    repo: "vocalisia/tesla-mag-ca",
    articlePath: "src/data/articles.ts",
    format: "mdx",
    i18nBlogPath: { fr: "/article", en: "/en/article", default: "/article" },
    enabled: false,
    disabledReason:
      "tesla-mag.ca stocke les articles dans un tableau TypeScript (src/data/articles.ts), pas en MDX. Pipeline autopilot MDX incompatible — tracking GSC/GA4 OK, publication désactivée.",
  },
  "trust-vault": {
    repo: "vocalisia/trust-vault",
    articlePath: "content/posts",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
    enabled: false,
    disabledReason:
      "trust-vault.com nécessite Supabase + Stripe + Prisma — le déploiement MDX via autopilot n'est pas testé avec l'auth/paywall de ce site. Activer manuellement après vérif pipeline.",
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
    // FR only — articlePath hardcoded to content/blog/fr; EN/DE would be written to fr/ but served from en/ → 404
    i18nBlogPath: { fr: "/fr/blog", default: "/fr/blog" },
  },
  "iapme-suisse": {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog/fr",
    format: "md",
    i18nBlogPath: { fr: "/fr/blog", default: "/fr/blog" },
  },
  iapme: {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog/fr",
    format: "md",
    i18nBlogPath: { fr: "/fr/blog", default: "/fr/blog" },
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
    i18nBlogPath: { fr: "/blog", default: "/blog" },
    enabled: false,
    disabledReason:
      "agents-ia.pro utilise des scripts Python (_generate_articles.py) pour générer des articles HTML. Le pipeline MDX autopilot est en conflit avec ce workflow existant.",
  },
  "master-seller": {
    repo: "vocalisia/master-seller",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: { fr: "/blog", default: "/blog" },
    enabled: false,
    disabledReason:
      "master-seller.fr n'a pas de connexion Vercel configurée dans ce repo — content/blog est vide (.gitkeep seul). Pipeline MDX non déployé en prod.",
  },
  whatsapp: {
    repo: "vocalisia/agent-whatsapp-ia-business",
    articlePath: "content/blog",
    format: "mdx",
    i18nBlogPath: { fr: "/fr/blog", en: "/en/blog", default: "/fr/blog" },
  },
  "agentic-whatsup": {
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
    enabled: false,
    disabledReason:
      "Domaine custom non encore connecté au repo vocalisia/fitnessmaison sur Vercel. Activer après configuration du domaine.",
  },
  factureimpayee: {
    repo: "vocalisia/factureimpayee",
    articlePath: "content/blog",
    format: "mdx",
    enabled: false,
    disabledReason:
      "factureimpayée.fr est un site Next.js autonome sans pipeline MDX autopilot — les articles sont gérés directement dans le repo factureimpayee/src, pas via autopilot.",
  },
  "facture-impayee": {
    repo: "vocalisia/factureimpayee",
    articlePath: "content/blog",
    format: "mdx",
    enabled: false,
    disabledReason:
      "factureimpayée.fr est un site Next.js autonome sans pipeline MDX autopilot — les articles sont gérés directement dans le repo factureimpayee/src, pas via autopilot.",
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

/**
 * Normalize: lowercase + strip accents + replace ANY non-alphanum with hyphen + trim hyphens.
 * Handles "Tesla Mag", "tesla-mag.ch", "TeslaMag.fr", "factureimpayée" uniformly.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-") // any non-alphanum run → hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing
}

/** Compact form (alphanum only): "tesla-mag" → "teslamag". Used for camelCase / no-separator inputs. */
function compactName(name: string): string {
  return normalizeName(name).replace(/-/g, "");
}

/** Match dashboard site name to repo config (same rules as autopilot route). */
export function resolveSiteRepoConfig(siteDisplayName: string): {
  normalizedSiteName: string;
  siteKey: string | null;
  repoConfig: SiteRepoConfig | null;
} {
  const normalizedSiteName = normalizeName(siteDisplayName);
  const compactInput = compactName(siteDisplayName);
  const keys = Object.keys(SITE_REPO_MAP);

  // 1. Match exact normalized (vocalis-pro → "vocalis-pro" pas "vocalis-blog")
  let siteKey: string | null =
    keys.find((k) => normalizeName(k) === normalizedSiteName) ?? null;

  // 2. Match exact compact (covers "TeslaMag", "teslamag.ch", etc.)
  if (!siteKey) {
    siteKey = keys.find((k) => compactName(k) === compactInput) ?? null;
  }

  // 3. Longest-prefix substring on normalized form
  if (!siteKey) {
    siteKey =
      keys
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const normK = normalizeName(k);
          return normalizedSiteName.includes(normK) || normK.includes(normalizedSiteName);
        }) ?? null;
  }

  // 4. Longest-prefix substring on compact form (last-resort safety net for disabled sites
  //    with weird display names — better a false positive matching a disabled config
  //    than a null that lets autopilot publish to 404 URLs).
  if (!siteKey && compactInput.length >= 4) {
    siteKey =
      keys
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((k) => {
          const compactK = compactName(k);
          return (
            compactK.length >= 4 &&
            (compactInput.includes(compactK) || compactK.includes(compactInput))
          );
        }) ?? null;
  }

  return {
    normalizedSiteName,
    siteKey,
    repoConfig: siteKey ? SITE_REPO_MAP[siteKey] : null,
  };
}
