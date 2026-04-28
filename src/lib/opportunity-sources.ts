import type { OpportunityKeywordRow } from "./opportunity-engine";

const SUGGEST_PREFIXES = [
  "comment",
  "pourquoi",
  "meilleur",
  "prix",
  "logiciel",
  "outil",
  "vs",
];

const TREND_LOCALES = [
  { geo: "FR", language: "fr-FR" },
  { geo: "US", language: "en-US" },
  { geo: "GB", language: "en-GB" },
  { geo: "DE", language: "de-DE" },
  { geo: "ES", language: "es-ES" },
  { geo: "IT", language: "it-IT" },
  { geo: "JP", language: "ja-JP" },
  { geo: "BR", language: "pt-BR" },
];

const REDDIT_DISCOVERY_SUBS = [
  "popular",
  "InternetIsBeautiful",
  "BuyItForLife",
  "coolgadgets",
  "Futurology",
  "Entrepreneur",
  "smallbusiness",
  "SideProject",
  "ProductHunters",
  "selfimprovement",
  "BehindTheClosetDoor",
  "ZeroWaste",
  "homeautomation",
  "biohackers",
  "Frugal",
  "GenZ",
  "Millennials",
  "DigitalNomad",
  "passive_income",
  "marketing",
];

export const COUNTRY_PROFILES: Record<string, {
  geo: string;
  language: string;
  hl: string;
  gl: string;
  redditSubs: string[];
  trendingExtraSeeds: string[];
  marketLabel: string;
}> = {
  GLOBAL: {
    geo: "US", language: "en-US", hl: "en", gl: "us",
    redditSubs: REDDIT_DISCOVERY_SUBS,
    trendingExtraSeeds: [],
    marketLabel: "Global / English-speaking",
  },
  FR: {
    geo: "FR", language: "fr-FR", hl: "fr", gl: "fr",
    redditSubs: ["france", "AskFrance", "vosfinances", "Quebec", "EntrepreneurFR"],
    trendingExtraSeeds: ["entreprise française", "auto entrepreneur", "SaaS France", "abonnement écolo", "produit local"],
    marketLabel: "France",
  },
  DE: {
    geo: "DE", language: "de-DE", hl: "de", gl: "de",
    redditSubs: ["de", "Finanzen", "Selbststaendig", "Unternehmensfuehrung", "AskDeutschland"],
    trendingExtraSeeds: ["Selbstständigkeit Tools", "Online Geld verdienen", "nachhaltige Produkte", "SaaS Deutschland"],
    marketLabel: "Deutschland",
  },
  ES: {
    geo: "ES", language: "es-ES", hl: "es", gl: "es",
    redditSubs: ["es", "Mexico", "argentina", "espanol", "Emprender"],
    trendingExtraSeeds: ["emprendedor latinoamerica", "negocio online España", "productos sostenibles", "SaaS español"],
    marketLabel: "España + LATAM",
  },
  IT: {
    geo: "IT", language: "it-IT", hl: "it", gl: "it",
    redditSubs: ["italy", "ItaliaPersonalFinance", "italianlearning", "Imprenditoria"],
    trendingExtraSeeds: ["partita iva opportunità", "lavoro online Italia", "prodotti sostenibili Italia"],
    marketLabel: "Italia",
  },
  GB: {
    geo: "GB", language: "en-GB", hl: "en", gl: "gb",
    redditSubs: ["unitedkingdom", "UKPersonalFinance", "ukbusiness", "AskUK", "smallbusinessuk"],
    trendingExtraSeeds: ["UK side hustle", "British SaaS", "sustainable UK brands", "limited company tools"],
    marketLabel: "United Kingdom",
  },
  CH: {
    geo: "CH", language: "de-CH", hl: "de", gl: "ch",
    redditSubs: ["Switzerland", "askswitzerland", "SchweizPersonalFinance", "GenevaSwitzerland"],
    trendingExtraSeeds: ["Schweizer SaaS", "PME Suisse outils", "indépendant Genève", "AHV optimieren"],
    marketLabel: "Suisse",
  },
  CA: {
    geo: "CA", language: "en-CA", hl: "en", gl: "ca",
    redditSubs: ["canada", "PersonalFinanceCanada", "CanadianInvestor", "QuebecLibre"],
    trendingExtraSeeds: ["Canadian small business", "Quebec startup", "outils PME Québec"],
    marketLabel: "Canada / Québec",
  },
  BR: {
    geo: "BR", language: "pt-BR", hl: "pt-BR", gl: "br",
    redditSubs: ["brasil", "investimentos", "empreendedorismo", "brasilivre"],
    trendingExtraSeeds: ["empreendedor Brasil", "renda extra", "SaaS Brasil", "negócio digital"],
    marketLabel: "Brasil",
  },
  JP: {
    geo: "JP", language: "ja-JP", hl: "ja", gl: "jp",
    redditSubs: ["japan", "japanlife", "japanresidents", "newsokur"],
    trendingExtraSeeds: ["副業 おすすめ", "起業 ツール", "SaaS 日本", "サブスク"],
    marketLabel: "日本",
  },
};

type SerpSnapshot = {
  relatedQuestions: string[];
  relatedSearches: string[];
  resultTitles: string[];
  resultUrls: string[];
};

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type SuggestResponse = [string, string[]] | [string, string[], unknown, unknown];

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeQuery(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractSerpSnippetValues(html: string, marker: RegExp): string[] {
  const values: string[] = [];
  for (const match of html.matchAll(marker)) {
    const value = decodeHtml(match[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (value) values.push(value);
  }
  return dedupe(values);
}

function extractGoogleResultUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/href="\/url\?q=([^"&]+)[^"]*"/g)) {
    try {
      const decoded = decodeURIComponent(match[1] ?? "");
      if (!/^https?:\/\//i.test(decoded)) continue;
      const hostname = new URL(decoded).hostname.toLowerCase();
      if (
        hostname.includes("google.") ||
        hostname.endsWith("gstatic.com") ||
        hostname.endsWith("youtube.com") ||
        hostname.endsWith("youtu.be")
      ) {
        continue;
      }
      urls.push(decoded);
    } catch {
      // ignore malformed URLs
    }
  }
  return dedupe(urls).slice(0, 10);
}

export async function fetchGoogleSuggestions(seed: string, hl = "fr"): Promise<string[]> {
  const variants = dedupe([seed, ...SUGGEST_PREFIXES.map((prefix) => `${prefix} ${seed}`)]);
  const collected: string[] = [];

  await Promise.all(
    variants.map(async (query) => {
      try {
        const url = new URL("https://suggestqueries.google.com/complete/search");
        url.searchParams.set("client", "firefox");
        url.searchParams.set("hl", hl);
        url.searchParams.set("q", query);

        const response = await fetchWithTimeout(url.toString(), {
          headers: { "User-Agent": "Mozilla/5.0 SEO Dashboard Opportunity Scanner" },
          next: { revalidate: 3600 },
        });
        if (!response.ok) return;

        const data = (await response.json()) as SuggestResponse;
        const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
        collected.push(...suggestions);
      } catch {
        // ignore provider errors; the main engine should still work from GSC data
      }
    })
  );

  return dedupe(collected).slice(0, 30);
}

export async function fetchRedditTrending(limit = 60, countryCode = "GLOBAL"): Promise<string[]> {
  const collected: string[] = [];
  const profile = COUNTRY_PROFILES[countryCode] ?? COUNTRY_PROFILES.GLOBAL;
  const subs = [...profile.redditSubs]
    .sort(() => Math.random() - 0.5)
    .slice(0, 8);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const url = `https://www.reddit.com/r/${sub}/top.json?t=week&limit=15`;
        const response = await fetchWithTimeout(url, {
          headers: {
            "User-Agent": "SEO-Dashboard-Opportunity-Scanner/1.0 (precursor-mode)",
            Accept: "application/json",
          },
        }, 5000);
        if (!response.ok) return;
        const data = (await response.json()) as {
          data?: { children?: Array<{ data?: { title?: string; ups?: number } }> };
        };
        const posts = data?.data?.children ?? [];
        for (const post of posts) {
          const title = post?.data?.title;
          const ups = post?.data?.ups ?? 0;
          if (typeof title === "string" && title.length > 8 && ups >= 50) {
            collected.push(title);
          }
        }
      } catch {
        // ignore single sub failure
      }
    })
  );

  return dedupe(collected).slice(0, limit);
}

export async function fetchHackerNewsTrending(limit = 30): Promise<string[]> {
  try {
    const url = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50";
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "SEO-Dashboard-Opportunity-Scanner/1.0" },
    }, 4000);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      hits?: Array<{ title?: string; points?: number }>;
    };
    const titles = (data?.hits ?? [])
      .filter((hit) => (hit.points ?? 0) >= 30 && typeof hit.title === "string")
      .map((hit) => hit.title as string);
    return dedupe(titles).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchProductHuntLaunches(limit = 25): Promise<string[]> {
  try {
    const response = await fetchWithTimeout("https://www.producthunt.com/feed", {
      headers: { "User-Agent": "SEO-Dashboard-Opportunity-Scanner/1.0" },
    }, 5000);
    if (!response.ok) return [];
    const xml = await response.text();
    const titles: string[] = [];
    for (const match of xml.matchAll(/<title>([^<]+)<\/title>/g)) {
      const value = decodeHtml(match[1] ?? "").trim();
      if (value && !/Product Hunt/i.test(value)) titles.push(value);
    }
    const descriptions: string[] = [];
    for (const match of xml.matchAll(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/g)) {
      const text = decodeHtml(match[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text && text.length > 12) descriptions.push(text.slice(0, 140));
    }
    return dedupe([...titles, ...descriptions]).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchAmazonRising(limit = 30): Promise<string[]> {
  const categories = [
    "electronics", "home-garden", "kitchen", "beauty", "sports",
    "office-products", "pet-supplies", "tools", "toys-games", "health-personal-care",
  ];
  const picked = [...categories].sort(() => Math.random() - 0.5).slice(0, 4);
  const results: string[] = [];

  await Promise.all(
    picked.map(async (cat) => {
      try {
        const url = `https://www.amazon.com/gp/movers-and-shakers/${cat}/`;
        const res = await fetchWithTimeout(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml",
          },
        }, 7000);
        if (!res.ok) return;
        const html = await res.text();
        for (const m of html.matchAll(/<div[^>]+class="[^"]*p13n-sc-truncate[^"]*"[^>]*>([^<]{10,200})<\/div>/g)) {
          const title = decodeHtml(m[1] ?? "").replace(/\s+/g, " ").trim();
          if (title) results.push(title);
        }
        for (const m of html.matchAll(/<a[^>]+class="a-link-normal[^"]*"[^>]+title="([^"]{10,200})"/g)) {
          const title = decodeHtml(m[1] ?? "").replace(/\s+/g, " ").trim();
          if (title) results.push(title);
        }
      } catch {
        // graceful degradation
      }
    })
  );

  const products: string[] = [];
  for (const raw of dedupe(results)) {
    const cleaned = raw
      .replace(/\b(?:pack of|set of|pcs|count|inch|inches|cm|mm|kg|lb|lbs|oz)\b.*$/i, "")
      .replace(/[\d.,]+\s*(?:%|off|free|sale)/gi, "")
      .split(/[,(\-—|]/)[0]
      .trim();
    if (cleaned.length >= 12 && cleaned.length <= 80) products.push(cleaned);
  }
  return dedupe(products).slice(0, limit);
}

export async function fetchIndieHackersRevenue(limit = 25): Promise<string[]> {
  try {
    const res = await fetchWithTimeout("https://www.indiehackers.com/products?revenueVerification=verified", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SEO-Dashboard/1.0)",
        "Accept": "text/html",
      },
    }, 7000);
    if (!res.ok) return [];
    const html = await res.text();
    const titles: string[] = [];
    for (const m of html.matchAll(/<a[^>]+class="[^"]*product-card__name[^"]*"[^>]*>([^<]+)<\/a>/g)) {
      titles.push(decodeHtml(m[1] ?? "").trim());
    }
    for (const m of html.matchAll(/<h3[^>]*>([A-Z][\w\s&.\-]{3,40})<\/h3>/g)) {
      titles.push(decodeHtml(m[1] ?? "").trim());
    }
    const taglines: string[] = [];
    for (const m of html.matchAll(/<p[^>]+class="[^"]*product-card__tagline[^"]*"[^>]*>([^<]{10,140})<\/p>/g)) {
      taglines.push(decodeHtml(m[1] ?? "").replace(/\s+/g, " ").trim());
    }
    return dedupe([...titles, ...taglines]).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchAppSumoNew(limit = 20): Promise<string[]> {
  try {
    const res = await fetchWithTimeout("https://appsumo.com/browse/?ordering=newest", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, 7000);
    if (!res.ok) return [];
    const html = await res.text();
    const items: string[] = [];
    for (const m of html.matchAll(/<h2[^>]*>([A-Z][\w\s&.\-—:]{3,80})<\/h2>/g)) {
      items.push(decodeHtml(m[1] ?? "").trim());
    }
    for (const m of html.matchAll(/<a[^>]+class="[^"]*deal-card[^"]*"[^>]*aria-label="([^"]{8,140})"/g)) {
      items.push(decodeHtml(m[1] ?? "").trim());
    }
    for (const m of html.matchAll(/"name":"([^"]{8,140})","description"/g)) {
      items.push(decodeHtml(m[1] ?? "").trim());
    }
    return dedupe(items).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchKickstarterTrending(limit = 15): Promise<string[]> {
  try {
    const res = await fetchWithTimeout("https://www.kickstarter.com/discover/popular?format=json", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SEO-Dashboard/1.0)",
        "Accept": "application/json,text/html",
      },
    }, 6000);
    if (!res.ok) return [];
    const text = await res.text();
    const titles: string[] = [];
    try {
      const data = JSON.parse(text) as { projects?: Array<{ name?: string; blurb?: string }> };
      for (const p of data.projects ?? []) {
        if (p.name) titles.push(p.name);
        if (p.blurb && p.blurb.length <= 140) titles.push(p.blurb);
      }
    } catch {
      for (const m of text.matchAll(/data-project-name="([^"]{8,120})"/g)) {
        titles.push(decodeHtml(m[1] ?? "").trim());
      }
    }
    return dedupe(titles).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchExplodingTopicsFeed(limit = 20): Promise<string[]> {
  try {
    const response = await fetchWithTimeout("https://explodingtopics.com/feed", {
      headers: { "User-Agent": "SEO-Dashboard-Opportunity-Scanner/1.0" },
    }, 4000);
    if (!response.ok) return [];
    const xml = await response.text();
    const titles: string[] = [];
    for (const match of xml.matchAll(/<title>([^<]+)<\/title>/g)) {
      const value = decodeHtml(match[1] ?? "").trim();
      if (value && !/exploding topics/i.test(value)) titles.push(value);
    }
    return dedupe(titles).slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchTrendingQueries(limit = 25, countryCode = "GLOBAL"): Promise<string[]> {
  const collected: string[] = [];
  const profile = COUNTRY_PROFILES[countryCode];
  const locales = profile && countryCode !== "GLOBAL"
    ? [{ geo: profile.geo, language: profile.language }]
    : TREND_LOCALES;

  await Promise.all(
    locales.map(async ({ geo, language }) => {
      try {
        const url = new URL("https://trends.google.com/trending/rss");
        url.searchParams.set("geo", geo);
        const response = await fetchWithTimeout(url.toString(), {
          headers: { "Accept-Language": language, "User-Agent": "Mozilla/5.0 SEO Dashboard Opportunity Scanner" },
          next: { revalidate: 3600 },
        });
        if (!response.ok) return;

        const xml = await response.text();
        const matches = Array.from(xml.matchAll(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/g));
        for (const match of matches.slice(1)) {
          if (match[1]) collected.push(match[1]);
        }
      } catch {
        // ignore provider errors
      }
    })
  );

  return dedupe(collected).slice(0, limit);
}

export async function fetchGoogleSerpSnapshot(query: string, hl = "fr", gl = "fr"): Promise<SerpSnapshot> {
  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("hl", hl);
    url.searchParams.set("gl", gl);
    url.searchParams.set("q", query);

    const acceptLanguage = `${hl},${hl.split("-")[0]};q=0.9,en;q=0.8`;
    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": acceptLanguage,
      },
      next: { revalidate: 3600 },
    }, 5000);

    if (!response.ok) {
      return { relatedQuestions: [], relatedSearches: [], resultTitles: [], resultUrls: [] };
    }

    const html = await response.text();
    const relatedQuestions = extractSerpSnippetValues(
      html,
      /"(?:related-question-pair|question)":\{"(?:.+?)?"?question":"([^"]+)"/g
    );
    const relatedSearches = extractSerpSnippetValues(
      html,
      /"query":"([^"]+)","label":"[^"]*related searches/gi
    );
    const resultTitles = extractSerpSnippetValues(
      html,
      /<h3[^>]*>(.*?)<\/h3>/g
    ).slice(0, 10);
    const resultUrls = extractGoogleResultUrls(html);

    if (
      html.length > 0 &&
      relatedQuestions.length === 0 &&
      relatedSearches.length === 0 &&
      resultTitles.length === 0 &&
      resultUrls.length === 0
    ) {
      console.warn(`[opportunity-sources] SERP snapshot returned no usable signals for query "${query}"`);
    }

    return {
      relatedQuestions: relatedQuestions.slice(0, 10),
      relatedSearches: relatedSearches.slice(0, 10),
      resultTitles,
      resultUrls,
    };
  } catch {
    return { relatedQuestions: [], relatedSearches: [], resultTitles: [], resultUrls: [] };
  }
}

export async function buildExternalSignalRows(
  baseKeywords: string[],
  existingQueries: Set<string>,
  countryCode = "GLOBAL"
): Promise<OpportunityKeywordRow[]> {
  const profile = COUNTRY_PROFILES[countryCode] ?? COUNTRY_PROFILES.GLOBAL;
  const seedsBase = dedupe([...baseKeywords, ...profile.trendingExtraSeeds]).slice(0, 6);
  const seeds = seedsBase;
  const [
    suggestionGroups,
    trending,
    serpSnapshots,
    redditTitles,
    hnTitles,
    phLaunches,
    explodingTopics,
    amazonRising,
    indieHackers,
    appSumoNew,
    kickstarter,
  ] = await Promise.all([
    Promise.all(seeds.map((seed) => fetchGoogleSuggestions(seed, profile.hl))),
    fetchTrendingQueries(40, countryCode),
    Promise.all(seeds.slice(0, 3).map((seed) => fetchGoogleSerpSnapshot(seed, profile.hl, profile.gl))),
    fetchRedditTrending(60, countryCode),
    countryCode === "GLOBAL" || countryCode === "GB" || countryCode === "CA" ? fetchHackerNewsTrending(30) : Promise.resolve([]),
    fetchProductHuntLaunches(25),
    fetchExplodingTopicsFeed(20),
    fetchAmazonRising(30),
    fetchIndieHackersRevenue(25),
    fetchAppSumoNew(20),
    fetchKickstarterTrending(15),
  ]);

  const serpDerived = serpSnapshots.flatMap((snapshot) => [
    ...snapshot.relatedQuestions,
    ...snapshot.relatedSearches,
  ]);

  type SignalSource = "amazon" | "indie" | "appsumo" | "kickstarter" | "trend" | "reddit" | "hn" | "ph" | "exploding" | "serp" | "suggest";
  const rows: OpportunityKeywordRow[] = [];
  const sourceMap = new Map<string, SignalSource>();
  const tag = (items: string[], source: SignalSource) => {
    for (const item of items) {
      const key = normalizeQuery(item);
      if (key && !sourceMap.has(key)) sourceMap.set(key, source);
    }
  };

  tag(amazonRising, "amazon");
  tag(indieHackers, "indie");
  tag(appSumoNew, "appsumo");
  tag(kickstarter, "kickstarter");
  tag(trending, "trend");
  tag(redditTitles, "reddit");
  tag(hnTitles, "hn");
  tag(phLaunches, "ph");
  tag(explodingTopics, "exploding");
  tag(serpDerived, "serp");

  const merged = dedupe([
    ...amazonRising,
    ...indieHackers,
    ...appSumoNew,
    ...kickstarter,
    ...suggestionGroups.flat(),
    ...trending,
    ...redditTitles,
    ...hnTitles,
    ...phLaunches,
    ...explodingTopics,
    ...serpDerived,
  ]);

  const shuffled = merged.sort(() => Math.random() - 0.5);

  for (const query of shuffled) {
    const normalized = normalizeQuery(query);
    if (!normalized || existingQueries.has(normalized)) continue;
    if (normalized.length < 4 || normalized.length > 120) continue;

    const words = normalized.split(" ").length;
    const source = sourceMap.get(normalized) ?? "suggest";

    const impressionsBase =
      source === "amazon" ? 14000 :
      source === "indie" ? 13000 :
      source === "appsumo" ? 12500 :
      source === "kickstarter" ? 12000 :
      source === "exploding" ? 11000 :
      source === "trend" ? 9000 :
      source === "reddit" ? 7500 :
      source === "ph" ? 7000 :
      source === "hn" ? 6500 :
      source === "serp" ? 6000 :
      5000;

    const prevRatio =
      source === "amazon" ? 0.15 :
      source === "indie" ? 0.20 :
      source === "appsumo" ? 0.20 :
      source === "kickstarter" ? 0.22 :
      source === "exploding" ? 0.18 :
      source === "trend" ? 0.25 :
      source === "reddit" ? 0.35 :
      source === "ph" ? 0.30 :
      source === "hn" ? 0.40 :
      source === "serp" ? 0.45 :
      0.55;

    const positionByLat: Record<string, number> = {
      amazon: 30, indie: 29, appsumo: 28, kickstarter: 27,
      exploding: 28, trend: 26, reddit: 25, ph: 24, hn: 23, serp: 22, suggest: 21,
    };

    rows.push({
      query,
      impressions_30d: impressionsBase + Math.max(0, words - 2) * 900,
      impressions_prev_30d: Math.round(impressionsBase * prevRatio),
      clicks_30d: Math.round(impressionsBase * 0.015),
      avg_position_30d: positionByLat[source] ?? 22,
      site_count: 0,
    });
  }

  return rows.slice(0, 120);
}
