export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getSQL, initDB } from "@/lib/db";
import { buildOpportunityCandidates, type OpportunityCandidate, type OpportunityKeywordRow } from "@/lib/opportunity-engine";
import { buildExternalSignalRows, COUNTRY_PROFILES } from "@/lib/opportunity-sources";
import { runWebResearch } from "@/lib/web-research";
import { requireApiSession } from "@/lib/api-auth";
import {
  buildLaunchPlan,
  checkDomainAvailability,
  deriveWhyNow,
  type DomainCheckResult,
  type LaunchPlan,
  type RevenueRange,
  type WhyNowSignal,
} from "@/lib/scanner-enrichment";

interface AggregatedKeywordRow {
  query: string;
  impressions_30d: string;
  impressions_prev_30d: string;
  clicks_30d: string;
  avg_position_30d: string;
  site_count: string;
  search_volume: string | null;
  search_volume_source: string | null;
}

type DiscoveryMode = "A" | "B" | "C";

interface StoredOpportunity {
  id?: number;
  niche: string;
  reason: string;
  site_type: string;
  core_keywords: string[];
  monthly_volume: number;
  volume_source?: string | null;
  gsc_impressions_30d?: number;
  competition: string;
  monetization: string;
  projected_traffic_6m: number;
  projected_revenue_6m: number;
  suggested_domains: string[];
  seed_articles: string[];
  target_countries: string[];
  target_languages: string[];
  competitors: { url: string; name: string }[];
  success_rate: number;
  revenue_timeline: { m1: number; m3: number; m6: number; m12: number };
  business_model: Record<string, unknown>;
  confidence_score: number;
  signal_source?: string;
  metric_status?: "keyword_planner_measured" | "gsc_signal_only" | "mixed_signal_only" | "external_signal_unmeasured";
  signal_sources?: string[];
  momentum_pct?: number;
  average_position?: number;
  opportunity_type?: string;
  sample_queries?: string[];
  status?: string;
  score_breakdown?: {
    growth: number;
    volume: number;
    weakness: number;
    specificity: number;
    business: number;
    portfolioDistance: number;
  };
  serp_evidence?: {
    relatedQuestions: string[];
    relatedSearches: string[];
    resultTitles: string[];
    resultUrls?: string[];
  };
  launch_plan?: LaunchPlan;
  time_to_rank_months?: number;
  why_now?: WhyNowSignal[];
  revenue_range?: RevenueRange;
  domain_available?: DomainCheckResult[];
}

const PORTFOLIO_HINTS = [
  "voice ai",
  "tesla ev",
  "cbd europe",
  "crypto trust",
  "business switzerland",
  "sales training",
  "ai hub",
  "ai agents",
  "lead generation",
  "seo tools",
  "beauty fashion",
];

const GLOBAL_DISCOVERY_SEEDS = [
  "ai workflow",
  "remote work setup",
  "pet accessories",
  "home gym recovery",
  "beauty device",
  "eco cleaning product",
  "sleep gadget",
  "smart kitchen tool",
  "travel organizer",
  "car accessory",
  "creator economy tool",
  "senior wellness",
];

const CATEGORY_DISCOVERY_SEEDS: Record<string, string[]> = {
  "e-commerce": [
    "best selling product",
    "amazon rising product",
    "eco product",
    "home gadget",
    "beauty device",
    "pet accessory",
  ],
  saas: [
    "ai automation software",
    "small business software",
    "workflow tool",
    "crm automation",
    "analytics dashboard",
    "no code app",
  ],
  blog: [
    "how to guide",
    "beginner tutorial",
    "question answer niche",
    "comparison guide",
    "practical advice",
  ],
  magazine: [
    "industry news",
    "trend report",
    "consumer guide",
    "market analysis",
    "expert review",
  ],
  directory: [
    "best agencies",
    "service providers",
    "local directory",
    "compare providers",
    "find expert",
  ],
  course: [
    "online course",
    "certification",
    "training program",
    "coaching niche",
    "learn skills",
  ],
  marketplace: [
    "marketplace platform",
    "freelance marketplace",
    "supplier marketplace",
    "two sided platform",
  ],
};

const COUNTRY_TO_ISO3: Record<string, string> = {
  FR: "FRA",
  CH: "CHE",
  BE: "BEL",
  CA: "CAN",
  GB: "GBR",
  DE: "DEU",
  ES: "ESP",
  IT: "ITA",
  BR: "BRA",
  JP: "JPN",
  GLOBAL: "USA",
};

const CATEGORY_DEFAULTS: Record<string, { site_type: string; monetization: string }> = {
  "e-commerce": { site_type: "e-commerce", monetization: "e-commerce" },
  saas: { site_type: "saas", monetization: "subscription" },
  blog: { site_type: "blog", monetization: "ads" },
  magazine: { site_type: "magazine", monetization: "ads" },
  directory: { site_type: "directory", monetization: "lead-gen" },
  course: { site_type: "blog", monetization: "affiliate" },
  marketplace: { site_type: "directory", monetization: "lead-gen" },
};

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function inferSiteType(candidate: OpportunityCandidate): string {
  if (candidate.intent === "commercial") return "directory";
  if (candidate.opportunityType === "question") return "blog";
  if (candidate.keywords.some((keyword) => /logiciel|software|saas|tool/i.test(keyword))) return "saas";
  return "magazine";
}

function inferMonetization(candidate: OpportunityCandidate): string {
  if (candidate.intent === "commercial") return "lead-gen";
  if (candidate.keywords.some((keyword) => /comparatif|best|meilleur|prix|tarif/i.test(keyword))) return "affiliate";
  return "ads";
}

export function fallbackOpportunity(candidate: OpportunityCandidate): StoredOpportunity {
  const metricsMeasured = candidate.measurementKind !== "external_signal";
  const siteType = inferSiteType(candidate);
  const monetization = inferMonetization(candidate);
  const competition = "unknown";
  const verifiedSearchVolume = candidate.searchVolume ?? 0;
  const root = slugify(candidate.clusterLabel.split(" ").slice(0, 3).join(" "));
  const projectedTraffic6m = 0;
  const projectedRevenue6m = 0;
  const confidence = Math.round(candidate.signalScore * 100);

  const competitors = (candidate.serpEvidence?.resultUrls ?? [])
    .slice(0, 4)
    .map((url) => {
      try {
        const host = new URL(url).hostname.replace(/^www\./i, "");
        return { url, name: host };
      } catch {
        return null;
      }
    })
    .filter((item): item is { url: string; name: string } => item !== null);

  return {
    niche: candidate.clusterLabel,
    reason: [
      verifiedSearchVolume > 0
        ? verifiedSearchVolume.toLocaleString("fr-FR") + " recherches mensuelles issues d'un import Keyword Planner vérifié."
        : metricsMeasured
          ? candidate.monthlyVolume.toLocaleString("fr-FR") + " impressions GSC observées sur 30 jours; volume de recherche non mesuré."
        : "Signal externe qualitatif détecté; volume de recherche non mesuré.",
      metricsMeasured
        ? candidate.momentumPct + "% de variation GSC face aux 30 jours précédents."
        : "Tendance, position Google et clics non mesurés.",
      candidate.rationale.join(". "),
    ].join(" "),
    site_type: siteType,
    core_keywords: candidate.keywords.slice(0, 5),
    monthly_volume: verifiedSearchVolume,
    volume_source: candidate.searchVolumeSources[0] ?? null,
    gsc_impressions_30d: metricsMeasured ? candidate.monthlyVolume : 0,
    competition,
    monetization,
    projected_traffic_6m: projectedTraffic6m,
    projected_revenue_6m: projectedRevenue6m,
    suggested_domains: [`${root}hub.com`, `${root}guide.com`].filter(Boolean),
    seed_articles: candidate.keywords.slice(0, 5).map((keyword) => `Guide complet: ${keyword}`),
    target_countries: ["FRA", "CHE", "BEL"],
    target_languages: ["fr"],
    competitors,
    success_rate: 0,
    revenue_timeline: {
      m1: 0,
      m3: 0,
      m6: 0,
      m12: 0,
    },
    business_model: {
      type: `${siteType} focused on ${candidate.intent} demand`,
      how_to_monetize: `Build a content moat around ${candidate.clusterLabel} and monetize through ${monetization}.`,
      launch_angle: candidate.rationale,
    },
    confidence_score: confidence,
    signal_source: candidate.signalSources.join("+") || candidate.measurementKind,
    metric_status: verifiedSearchVolume > 0
      ? "keyword_planner_measured"
      : candidate.measurementKind === "external_signal"
      ? "external_signal_unmeasured"
      : candidate.measurementKind === "mixed"
        ? "mixed_signal_only"
        : "gsc_signal_only",
    signal_sources: candidate.signalSources,
    momentum_pct: candidate.momentumPct,
    average_position: candidate.averagePosition,
    opportunity_type: candidate.opportunityType,
    sample_queries: candidate.sampleQueries,
    status: "pending",
    score_breakdown: candidate.scoreBreakdown,
    serp_evidence: candidate.serpEvidence ?? {
      relatedQuestions: [],
      relatedSearches: [],
      resultTitles: [],
      resultUrls: [],
    },
  };
}

function looksLikeRedditFragment(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 10) return true;
  if (trimmed.length > 80) return true;
  if (/[?!]/.test(trimmed)) return true;
  const startsWithVerb = /^(how|why|what|when|where|who|did|do|does|can|should|would|have|has|is|are|was|were|drop|launched|built|built|after|tell|share|why is|comment|pourquoi|quels?|que|qui|est-il|est-ce|how many|i (built|launched|made|sold|tried|got|stopped|quit))\b/i.test(trimmed);
  if (startsWithVerb) return true;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 9) return true;
  const words = trimmed.split(/\s+/);
  const properNouns = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (properNouns >= 4 && wordCount <= 6) {
    return false;
  }
  return false;
}

const GENERIC_NICHE_PATTERNS = [
  /\b(home workouts?|fitness|weight loss|meal prep|travel tips|productivity|side hustle|make money|beauty tips)\b/i,
  /\b(busy professionals|beginners|students|parents|entrepreneurs|small business owners)\b/i,
  /\b(gadgets?|tools?|guide|tips|ideas|resources|solutions)\b/i,
];

const SPECIFICITY_MARKERS = [
  /\b(ai|automation|agent|api|compliance|invoice|debt|tesla|ev|cbd|switzerland|suisse|lead gen|voice|whatsapp|ga4|gsc|schema|llm)\b/i,
  /\b(b2b|pme|smb|saas|crm|erp|fintech|healthtech|legaltech|martech|sales ops|support)\b/i,
  /\b(france|suisse|swiss|canada|quebec|uk|deutschland|italia|latam|belgique)\b/i,
];

const NEWS_OR_CURIOSITY_PATTERNS = [
  /\b(dies at|dead at|obituary|author of|unearths|dig of the century|largest .* to date)\b/i,
  /\b(soar with|grades|class|university|berkeley|notre dame|sagrada|lego|persepolis)\b/i,
  /\b(3d-printed book|raised lettering|homepage construction kit|small footprint)\b/i,
  /\b(kvarn|vllm|kv-cache|huawei|native backend|quantization)\b/i,
  /['"â€œâ€]/,
  /\b(breaking|wins|loses|charged|arrested|election|earthquake|storm|war|movie|series|episode)\b/i,
];

function looksLikeNewsOrCuriosity(opp: StoredOpportunity): boolean {
  const text = [
    opp.niche,
    ...(opp.core_keywords ?? []),
    ...(opp.sample_queries ?? []),
    opp.reason,
  ].join(" ");
  if (NEWS_OR_CURIOSITY_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (opp.site_type === "magazine" && opp.monetization === "ads" && (opp.core_keywords ?? []).some((keyword) => keyword.includes(":"))) {
    return true;
  }

  const hasBusinessMarker = SPECIFICITY_MARKERS.some((pattern) => pattern.test(text)) ||
    /\b(saas|tool|software|affiliate|lead|marketplace|e-commerce|subscription|automation|business|b2b)\b/i.test(text);
  const words = opp.niche.trim().split(/\s+/);
  const titleCaseWords = words.filter((word) => /^[A-Z][a-z]+/.test(word)).length;
  return !hasBusinessMarker && opp.site_type === "magazine" && opp.monetization === "ads" && titleCaseWords >= 2;
}

function opportunityQualityScore(opp: StoredOpportunity): number {
  const text = [
    opp.niche,
    opp.reason,
    ...(opp.core_keywords ?? []),
    ...(opp.sample_queries ?? []),
    ...(opp.why_now ?? []).map((signal) => `${signal.source} ${signal.signal}`),
  ].join(" ").toLowerCase();

  let score = 0;
  score += Math.min(30, Math.max(0, Number(opp.confidence_score || 0) * 0.25));
  const observedGscImpressions = Number(opp.gsc_impressions_30d || 0);
  score += Math.min(18, Math.log10(Math.max(10, observedGscImpressions)) * 4);
  score += Math.min(16, Math.max(0, Number(opp.momentum_pct || 0)) / 4);
  score += (opp.why_now?.length ?? 0) >= 2 ? 14 : (opp.why_now?.length ?? 0) * 6;
  score += (opp.serp_evidence?.relatedQuestions?.length ?? 0) >= 3 ? 8 : 0;
  score += SPECIFICITY_MARKERS.some((pattern) => pattern.test(text)) ? 16 : 0;
  score += /lead-gen|subscription|saas|affiliate|e-commerce/i.test(opp.monetization) ? 8 : 0;

  const nicheWordCount = opp.niche.trim().split(/\s+/).length;
  if (nicheWordCount <= 2) score -= 16;
  if (GENERIC_NICHE_PATTERNS.some((pattern) => pattern.test(opp.niche)) && !SPECIFICITY_MARKERS.some((pattern) => pattern.test(text))) {
    score -= 28;
  }
  if ((opp.core_keywords ?? []).some((keyword) => GENERIC_NICHE_PATTERNS.some((pattern) => pattern.test(keyword))) && !SPECIFICITY_MARKERS.some((pattern) => pattern.test(text))) {
    score -= 12;
  }
  if (!opp.reason || opp.reason.length < 90) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function hasSentenceLikeSignal(opp: StoredOpportunity): boolean {
  const signals = [opp.niche, ...(opp.core_keywords ?? []), ...(opp.sample_queries ?? [])];
  return signals.some((signal) => {
    const words = signal.trim().split(/\s+/);
    return words.length > 7 && /\b(can|is|are|was|were|will|would|should|wipes?|built|borrowed|clean)\b/i.test(signal);
  });
}

function hasEnoughDemandVariants(opp: StoredOpportunity): boolean {
  const variants = new Set(
    [...(opp.core_keywords ?? []), ...(opp.sample_queries ?? [])]
      .map((signal) => signal.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .filter(Boolean)
  );
  return variants.size >= 2;
}
function isHighQualityOpportunity(opp: StoredOpportunity): boolean {
  if (looksLikeRedditFragment(opp.niche)) return false;
  if (hasSentenceLikeSignal(opp)) return false;
  if (!hasEnoughDemandVariants(opp)) return false;
  if (looksLikeNewsOrCuriosity(opp)) return false;
  const quality = opportunityQualityScore(opp);
  if (quality < 58) return false;
  const text = `${opp.niche} ${(opp.core_keywords ?? []).join(" ")} ${(opp.sample_queries ?? []).join(" ")}`;
  if (GENERIC_NICHE_PATTERNS.some((pattern) => pattern.test(text)) && quality < 74) return false;
  return true;
}

/* Legacy provider-based enrichment intentionally disabled.
async function enrichCandidatesWithAI(
  candidates: OpportunityCandidate[],
  preferredCategories: string[] = [],
  contextKey = "global"
): Promise<StoredOpportunity[] | null> {
  const shortlist = candidates.map((candidate, index) => ({
    id: index + 1,
    niche_hint: candidate.clusterLabel,
    keywords: candidate.keywords.slice(0, 5),
    sample_queries: candidate.sampleQueries.slice(0, 8),
    monthly_volume: candidate.monthlyVolume,
    momentum_pct: candidate.momentumPct,
    average_position: candidate.averagePosition,
    signal_score: candidate.signalScore,
    opportunity_type: candidate.opportunityType,
    intent: candidate.intent,
    rationale: candidate.rationale,
    score_breakdown: candidate.scoreBreakdown,
    serp_evidence: candidate.serpEvidence ?? null,
  }));

  const categoryDirective = preferredCategories.length > 0
    ? `\n\nðŸŽ¯ CONTRAINTE OBLIGATOIRE site_type :
Les niches DOIVENT Ãªtre de type : ${preferredCategories.map((c) => `"${c}"`).join(" OU ")}.
NE PROPOSE AUCUNE niche en dehors de ces types. Si un signal ne se prÃªte pas Ã  ${preferredCategories.join("/")}, IGNORE-le.
${preferredCategories.includes("e-commerce") ? "Pour e-commerce : pense produits physiques (DTC, dropshipping, marques de niche, accessoires, gadgets, abonnement physique, alimentation spÃ©cialisÃ©e, beautÃ©, lifestyle, maison)." : ""}
${preferredCategories.includes("saas") ? "Pour saas : pense outils logiciels, dashboards, agents IA, automation, API, productivitÃ©, integration, AI tools." : ""}
${preferredCategories.includes("course") ? "Pour course : pense formations en ligne, certifications, coaching, infoproduits, cohort-based courses." : ""}
${preferredCategories.includes("marketplace") ? "Pour marketplace : pense plateformes 2-sided (offre/demande), aggregateurs, places de marchÃ© de niche." : ""}`
    : "";

  const prompt = `Tu es analyste SEO + business senior connectÃ© au web via Perplexity/Sonar quand disponible. Ã€ partir de signaux multi-sources (Amazon Best Sellers Rising, Indie Hackers revenus vÃ©rifiÃ©s, AppSumo nouveautÃ©s, Kickstarter trending, Reddit, HN, Product Hunt, Google Trends), tu dois SYNTHÃ‰TISER des **niches business rÃ©elles Ã  fort potentiel commercial**, pas rÃ©pÃ©ter les titres bruts.

ðŸŽ¯ PRIORITÃ‰ AUX SIGNAUX COMMERCIAUX :
- Amazon Best Sellers = vraie demande consommateurs (e-commerce / produit physique)
- Indie Hackers verified revenue = SaaS qui font vraiment â‚¬â‚¬â‚¬ â†’ modÃ¨le Ã  reproduire
- AppSumo = SaaS validÃ©s par marchÃ© (ils paient pour Ãªtre listÃ©s)
- Kickstarter = produits financÃ©s (validation marchÃ© prÃ©coce)
- Ces sources sont 3Ã— plus importantes que Reddit/HN pour identifier de VRAIS business.${categoryDirective}

âš ï¸ RÃˆGLE CAPITALE :
- Une niche n'est JAMAIS une question. JAMAIS un titre Reddit. JAMAIS une phrase.
- Une niche = un MARCHÃ‰ ou un SECTEUR (2-5 mots, type "Outils SaaS pour freelances", "Gadgets cuisine zÃ©ro dÃ©chet", "Formation IA pour PME").
- Les volumes et positions ne sont PAS une vÃ©ritÃ© Google. Tu ne dois PAS inventer un "volume/mois".
- Le champ monthly_volume doit reprendre/agrÃ©ger prudemment les signaux numÃ©riques fournis dans INPUT; si le signal est faible ou incertain, baisse confidence_score au lieu de gonfler le volume.
- Si tu utilises du contexte web Perplexity, il sert Ã  valider: concurrents, angles, problÃ¨mes clients, tendance, maturitÃ© marchÃ©. Il ne remplace pas GSC/Keyword Planner/VPS tracker.
- Si le signal brut est "Quels sont vos tips de vie adulte que personne ne t'apprend ?" â†’ la niche rÃ©elle est "Conseils pratiques jeunes adultes" ou "Education financiÃ¨re 18-25 ans".
- Si le signal brut est "Drop your SaaS and I'll tell you how to get 100 users" â†’ la niche rÃ©elle est "Acquisition utilisateurs early-stage SaaS".

INPUT (signaux bruts Ã  analyser, PAS Ã  recopier):
${JSON.stringify(shortlist, null, 2)}

MÃ‰THODE :
1. Lis tous les signaux. Identifie les **PATTERNS** (groupes de signaux qui pointent vers le mÃªme besoin/marchÃ©).
2. Pour chaque pattern, crÃ©e 1 niche commerciale prÃ©cise (2-5 mots).
3. Choisis des niches avec un VRAI potentiel business (pas anecdotique).
4. Mots-clÃ©s = termes commerciaux que les gens cherchent dans Google (pas le titre Reddit brut).

FORMAT JSON STRICT, 5 Ã  8 niches max :
{
  "opportunities": [
    {
      "niche": "Nom court 2-5 mots (ex: 'Outils acquisition early SaaS')",
      "reason": "Pourquoi cette niche, basÃ©e sur 2-3 signaux concrets que tu cites + validation web si disponible",
      "site_type": "blog | magazine | e-commerce | saas | directory",
      "core_keywords": ["mot-cle commercial 1", "mot-cle commercial 2", "..."],
      "monthly_volume": 12000,
      "competition": "low | medium | high",
      "monetization": "ads | affiliate | e-commerce | subscription | lead-gen",
      "projected_traffic_6m": 1800,
      "projected_revenue_6m": 900,
      "suggested_domains": ["nicheguide.com", "nichelab.com"],
      "seed_articles": ["Titre article 1 en FR", "Titre article 2", "Titre 3", "Titre 4", "Titre 5"],
      "target_countries": ["FRA", "CHE"],
      "target_languages": ["fr"],
      "competitors": [],
      "success_rate": 65,
      "revenue_timeline": {"m1": 0, "m3": 120, "m6": 900, "m12": 2200},
      "business_model": {
        "type": "Type business court",
        "how_to_monetize": "Plan monÃ©tisation concret"
      },
      "confidence_score": 78
    }
  ]
}

Tout le contenu texte doit Ãªtre en FRANÃ‡AIS si les signaux sont francophones, sinon en ANGLAIS.`;

  const today = new Date().toISOString().slice(0, 10);
  const shortlistHash = createHash("sha256").update(JSON.stringify(shortlist.slice(0, 5))).digest("hex").slice(0, 16);
  const { reply: aiResponse } = await askAICached({
    cacheKey: `opp-scan:${today}:${contextKey}:${shortlistHash}:${preferredCategories.join(",")}`,
    messages: [{ role: "user", content: prompt }],
    model: "search",
    maxTokens: 3200,
  });
  const cleaned = cleanJsonBlock(aiResponse);
  if (!cleaned) {
    throw new Error("AI returned an empty response");
  }
  const parsed = JSON.parse(cleaned) as { opportunities?: StoredOpportunity[] };
  return parsed.opportunities?.length ? parsed.opportunities : null;
}
*/

function applyRequestedMarketAndCategory(
  opp: StoredOpportunity,
  requestedCountries: string[],
  requestedCategories: string[]
): StoredOpportunity {
  const selectedCountries = requestedCountries.includes("GLOBAL")
    ? ["FRA", "CHE", "BEL"]
    : requestedCountries.map((country) => COUNTRY_TO_ISO3[country] ?? country).slice(0, 5);
  const selectedLanguages = requestedCountries.includes("GLOBAL")
    ? ["fr", "en"]
    : Array.from(new Set(requestedCountries.map((country) => COUNTRY_PROFILES[country]?.hl ?? "fr"))).slice(0, 3);

  if (requestedCategories.length === 0) {
    return {
      ...opp,
      target_countries: selectedCountries.length > 0 ? selectedCountries : opp.target_countries,
      target_languages: selectedLanguages.length > 0 ? selectedLanguages : opp.target_languages,
    };
  }

  const primary = requestedCategories[0]!;
  const defaults = CATEGORY_DEFAULTS[primary] ?? { site_type: primary, monetization: opp.monetization };

  return {
    ...opp,
    site_type: defaults.site_type,
    monetization: defaults.monetization,
    target_countries: selectedCountries.length > 0 ? selectedCountries : opp.target_countries,
    target_languages: selectedLanguages.length > 0 ? selectedLanguages : opp.target_languages,
    signal_source: `${opp.signal_source ?? "gsc"}:cat-${primary}`,
  };
}

async function enrichCandidatesWithFreeSerpContext(candidates: OpportunityCandidate[]): Promise<OpportunityCandidate[]> {
  const snapshotResults = await Promise.allSettled(
    candidates.slice(0, 4).map((candidate) => runWebResearch(candidate.clusterLabel, {
      locale: "fr-FR",
      maxSources: 8,
      maxQueries: 4,
      depth: "quick",
      focus: "content",
    }))
  );
  const reports = snapshotResults.map((result) => (result.status === "fulfilled" ? result.value : null));

  return candidates.map((candidate, index) => {
    const report = reports[index];
    if (!report) return candidate;
    const observedTerms = (report.keyword_clusters ?? [])
      .flatMap((cluster) => cluster.keywords.map((item) => item.keyword));
    const executedQueries = (report.query_plan ?? []).map((step) => step.query);
    const extraQueries = [...candidate.sampleQueries, ...observedTerms, ...executedQueries]
      .filter(Boolean)
      .slice(0, 8);
    const extraRationale = [...candidate.rationale];
    if (report.sources.length > 0) {
      extraRationale.push(report.sources.length + " sources publiques observées");
    }
    if ((report.claims ?? []).some((claim) => claim.confidence === "corroborated")) {
      extraRationale.push("au moins une affirmation corroborée par plusieurs domaines");
    }

    return {
      ...candidate,
      sampleQueries: extraQueries,
      rationale: extraRationale.slice(0, 6),
      serpEvidence: {
        relatedQuestions: observedTerms.filter((term) =>
          /^(comment|pourquoi|quel|quelle|combien|how|why|what|which)\b/i.test(term)
        ).slice(0, 8),
        relatedSearches: executedQueries.slice(0, 8),
        resultTitles: report.sources.map((source) => source.title).slice(0, 8),
        resultUrls: report.sources.map((source) => source.url).slice(0, 8),
      },
    };
  });
}

function parseDiscoveryMode(value: unknown): DiscoveryMode {
  return value === "A" || value === "B" || value === "C" ? value : "B";
}

function buildModeConfig(mode: DiscoveryMode) {
  if (mode === "A") {
    return {
      portfolioPreference: "close" as const,
      signalLabel: "portfolio",
      keywordRowsMode: "portfolio" as const,
      externalSeedMode: "portfolio" as const,
    };
  }

  if (mode === "C") {
    return {
      portfolioPreference: "distant" as const,
      signalLabel: "global-discovery",
      keywordRowsMode: "external-only" as const,
      externalSeedMode: "global" as const,
    };
  }

  return {
    portfolioPreference: "balanced" as const,
    signalLabel: "portfolio+global",
    keywordRowsMode: "mixed" as const,
    externalSeedMode: "hybrid" as const,
  };
}

/* Legacy response sanitizer retained only as migration reference.
function sanitizeOpportunity(
  raw: Partial<StoredOpportunity>,
  fallback: StoredOpportunity
): OpportunityInsertable {
  return {
    niche: typeof raw.niche === "string" && raw.niche.trim() ? raw.niche.trim() : fallback.niche,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : fallback.reason,
    site_type: typeof raw.site_type === "string" && raw.site_type.trim() ? raw.site_type : fallback.site_type,
    core_keywords: Array.isArray(raw.core_keywords) && raw.core_keywords.length
      ? raw.core_keywords.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.core_keywords,
    monthly_volume: Number.isFinite(raw.monthly_volume) ? Math.round(raw.monthly_volume as number) : fallback.monthly_volume,
    competition: typeof raw.competition === "string" && raw.competition.trim() ? raw.competition : fallback.competition,
    monetization: typeof raw.monetization === "string" && raw.monetization.trim() ? raw.monetization : fallback.monetization,
    projected_traffic_6m: Number.isFinite(raw.projected_traffic_6m)
      ? Math.round(raw.projected_traffic_6m as number)
      : fallback.projected_traffic_6m,
    projected_revenue_6m: Number.isFinite(raw.projected_revenue_6m)
      ? Math.round(raw.projected_revenue_6m as number)
      : fallback.projected_revenue_6m,
    suggested_domains: Array.isArray(raw.suggested_domains) && raw.suggested_domains.length
      ? raw.suggested_domains.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3)
      : fallback.suggested_domains,
    seed_articles: Array.isArray(raw.seed_articles) && raw.seed_articles.length
      ? raw.seed_articles.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.seed_articles,
    target_countries: Array.isArray(raw.target_countries) && raw.target_countries.length
      ? raw.target_countries.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.target_countries,
    target_languages: Array.isArray(raw.target_languages) && raw.target_languages.length
      ? raw.target_languages.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.target_languages,
    competitors: Array.isArray(raw.competitors)
      ? raw.competitors
          .filter((value): value is { url: string; name: string } => (
            typeof value === "object" &&
            value !== null &&
            typeof (value as { url?: unknown }).url === "string" &&
            typeof (value as { name?: unknown }).name === "string"
          ))
          .slice(0, 5)
      : fallback.competitors,
    success_rate: Number.isFinite(raw.success_rate) ? Math.round(raw.success_rate as number) : fallback.success_rate,
    revenue_timeline:
      raw.revenue_timeline &&
      typeof raw.revenue_timeline === "object" &&
      !Array.isArray(raw.revenue_timeline)
        ? (() => {
            const timeline = raw.revenue_timeline as Record<string, string | number | null | undefined>;
            return {
              m1: toNumber(timeline.m1),
              m3: toNumber(timeline.m3),
              m6: toNumber(timeline.m6),
              m12: toNumber(timeline.m12),
            };
          })()
        : fallback.revenue_timeline,
    business_model:
      raw.business_model && typeof raw.business_model === "object" && !Array.isArray(raw.business_model)
        ? raw.business_model
        : fallback.business_model,
    confidence_score: Number.isFinite(raw.confidence_score)
      ? Math.round(raw.confidence_score as number)
      : fallback.confidence_score,
    signal_source: typeof raw.signal_source === "string" && raw.signal_source.trim() ? raw.signal_source : fallback.signal_source,
    momentum_pct: Number.isFinite(raw.momentum_pct) ? Number(raw.momentum_pct) : fallback.momentum_pct,
    average_position: Number.isFinite(raw.average_position) ? Number(raw.average_position) : fallback.average_position,
    opportunity_type: typeof raw.opportunity_type === "string" && raw.opportunity_type.trim()
      ? raw.opportunity_type
      : fallback.opportunity_type,
    sample_queries: Array.isArray(raw.sample_queries) && raw.sample_queries.length
      ? raw.sample_queries.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 6)
      : fallback.sample_queries,
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status : fallback.status,
    score_breakdown:
      raw.score_breakdown &&
      typeof raw.score_breakdown === "object" &&
      !Array.isArray(raw.score_breakdown)
        ? {
            growth: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).growth),
            volume: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).volume),
            weakness: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).weakness),
            specificity: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).specificity),
            business: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).business),
            portfolioDistance: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).portfolioDistance),
          }
        : fallback.score_breakdown,
    serp_evidence:
      raw.serp_evidence &&
      typeof raw.serp_evidence === "object" &&
      !Array.isArray(raw.serp_evidence)
        ? {
            relatedQuestions: Array.isArray((raw.serp_evidence as Record<string, unknown>).relatedQuestions)
              ? ((raw.serp_evidence as Record<string, unknown>).relatedQuestions as unknown[])
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .slice(0, 8)
              : fallback.serp_evidence?.relatedQuestions ?? [],
            relatedSearches: Array.isArray((raw.serp_evidence as Record<string, unknown>).relatedSearches)
              ? ((raw.serp_evidence as Record<string, unknown>).relatedSearches as unknown[])
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .slice(0, 8)
              : fallback.serp_evidence?.relatedSearches ?? [],
            resultTitles: Array.isArray((raw.serp_evidence as Record<string, unknown>).resultTitles)
              ? ((raw.serp_evidence as Record<string, unknown>).resultTitles as unknown[])
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .slice(0, 8)
              : fallback.serp_evidence?.resultTitles ?? [],
          }
        : fallback.serp_evidence,
  };
}
*/

/**
 * POST /api/opportunities/scan
 *
 * Scans verified GSC observations, imported Keyword Planner volumes and
 * qualitative public web signals to find evidence-backed niche candidates.
 *
 * Returns scored opportunities with explicit metric boundaries.
 */
export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  const sql = getSQL();

  try {
    let requestedMode: DiscoveryMode = "B";
    let requestedCountries: string[] = ["GLOBAL"];
    let requestedCategories: string[] = [];
    try {
      const body = await request.json() as { discovery_mode?: unknown; country?: unknown; countries?: unknown; categories?: unknown };
      requestedMode = parseDiscoveryMode(body.discovery_mode);
      if (Array.isArray(body.countries) && body.countries.length > 0) {
        requestedCountries = body.countries
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) => c.trim().toUpperCase());
      } else if (typeof body.country === "string" && body.country.trim()) {
        requestedCountries = [body.country.trim().toUpperCase()];
      }
      if (requestedCountries.length === 0) requestedCountries = ["GLOBAL"];

      if (Array.isArray(body.categories)) {
        requestedCategories = body.categories
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) => c.trim().toLowerCase())
          .filter((c) => c !== "all");
      }
    } catch {
      requestedMode = "B";
    }
    const modeConfig = buildModeConfig(requestedMode);
    const scanContextKey = [
      requestedMode,
      requestedCountries.slice().sort().join("-"),
      requestedCategories.slice().sort().join("-") || "all",
    ].join(":");

    await initDB();

    const nicheData = (await sql`
      WITH current_window AS (
        SELECT
          query,
          SUM(impressions) AS impressions_30d,
          SUM(clicks) AS clicks_30d,
          AVG(position) AS avg_position_30d,
          COUNT(DISTINCT site_id) AS site_count
        FROM search_console_data
        WHERE date >= NOW() - INTERVAL '30 days'
          AND query IS NOT NULL
          AND impressions >= 5
        GROUP BY query
      ),
      previous_window AS (
        SELECT
          query,
          SUM(impressions) AS impressions_prev_30d
        FROM search_console_data
        WHERE date >= NOW() - INTERVAL '60 days'
          AND date < NOW() - INTERVAL '30 days'
          AND query IS NOT NULL
          AND impressions >= 5
        GROUP BY query
      ),
      keyword_planner AS (
        SELECT
          LOWER(keyword) AS keyword_key,
          MAX(volume_market) FILTER (
            WHERE volume_source LIKE 'google_kp_real_%'
              AND volume_market IS NOT NULL
              AND volume_market > 0
          ) AS search_volume,
          MAX(volume_source) FILTER (
            WHERE volume_source LIKE 'google_kp_real_%'
              AND volume_market IS NOT NULL
              AND volume_market > 0
          ) AS search_volume_source
        FROM tracked_keywords
        GROUP BY LOWER(keyword)
      )
      SELECT
        c.query,
        c.impressions_30d,
        COALESCE(p.impressions_prev_30d, 0) AS impressions_prev_30d,
        c.clicks_30d,
        c.avg_position_30d,
        c.site_count,
        kp.search_volume,
        kp.search_volume_source
      FROM current_window c
      LEFT JOIN previous_window p ON p.query = c.query
      LEFT JOIN keyword_planner kp ON kp.keyword_key = LOWER(c.query)
      WHERE c.impressions_30d >= 25
      ORDER BY c.impressions_30d DESC
      LIMIT 500
    `) as AggregatedKeywordRow[];

    const sites = await sql`SELECT name, url FROM sites WHERE is_active = true`;
    const keywordRows: OpportunityKeywordRow[] = nicheData.map((row) => ({
      query: row.query,
      impressions_30d: toNumber(row.impressions_30d),
      impressions_prev_30d: toNumber(row.impressions_prev_30d),
      clicks_30d: toNumber(row.clicks_30d),
      avg_position_30d: toNumber(row.avg_position_30d),
      site_count: toNumber(row.site_count),
      measurement_kind: "gsc",
      signal_source: "gsc",
      search_volume: row.search_volume == null ? null : toNumber(row.search_volume),
      search_volume_source: row.search_volume_source,
    }));

    const existingQueries = new Set(keywordRows.map((row) => row.query.toLowerCase().trim()));
    const portfolioSeeds = keywordRows
      .sort((a, b) => b.impressions_30d - a.impressions_30d)
      .slice(0, 12)
      .map((row) => row.query);
    const countrySeeds = requestedCountries
      .flatMap((country) => COUNTRY_PROFILES[country]?.trendingExtraSeeds ?? [])
      .filter(Boolean);
    const categorySeeds = requestedCategories
      .flatMap((category) => CATEGORY_DISCOVERY_SEEDS[category] ?? [])
      .filter(Boolean);
    const externalSeedPool =
      modeConfig.externalSeedMode === "portfolio"
        ? [...categorySeeds, ...countrySeeds, ...portfolioSeeds]
        : modeConfig.externalSeedMode === "global"
          ? [...categorySeeds, ...countrySeeds, ...GLOBAL_DISCOVERY_SEEDS]
          : [...categorySeeds, ...countrySeeds, ...portfolioSeeds.slice(0, 6), ...GLOBAL_DISCOVERY_SEEDS.slice(0, 6)];
    const safeExternalSeedPool = externalSeedPool.length
      ? externalSeedPool
      : PORTFOLIO_HINTS.slice(0, 8);
    const perCountryRows = await Promise.all(
      requestedCountries.map((cc) =>
        buildExternalSignalRows(
          safeExternalSeedPool,
          modeConfig.keywordRowsMode === "external-only" ? new Set<string>() : existingQueries,
          cc
        )
      )
    );
    const seenExternalQueries = new Set<string>();
    const externalRows: typeof perCountryRows[number] = [];
    for (const rows of perCountryRows) {
      for (const row of rows) {
        const key = row.query.toLowerCase().trim();
        if (seenExternalQueries.has(key)) continue;
        seenExternalQueries.add(key);
        externalRows.push(row);
      }
    }
    const shouldPrioritizeLocalized = !requestedCountries.includes("GLOBAL") || requestedCategories.length > 0;
    const mergedRows =
      modeConfig.keywordRowsMode === "portfolio"
        ? (keywordRows.length > 0 ? keywordRows : externalRows)
        : modeConfig.keywordRowsMode === "external-only"
          ? externalRows
          : shouldPrioritizeLocalized
            ? [...externalRows, ...keywordRows.slice(0, 120)]
            : [...keywordRows, ...externalRows];

    const candidates = await enrichCandidatesWithFreeSerpContext(
      buildOpportunityCandidates(mergedRows, {
        minVolume: 5000,
        maxCandidates: 8,
        existingPortfolioHints: [...PORTFOLIO_HINTS, ...sites.map((site) => `${site.name ?? ""} ${site.url ?? ""}`)],
        portfolioPreference: modeConfig.portfolioPreference,
      })
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        opportunities: [],
        keywords_analyzed: mergedRows.length,
        sites_analyzed: sites.length,
        discovery_mode: requestedMode,
      });
    }

    let opportunities: StoredOpportunity[] =
      candidates.map((candidate) => {
        const opportunity = fallbackOpportunity(candidate);
        return {
          ...opportunity,
          signal_source: `${modeConfig.signalLabel}:${opportunity.signal_source ?? "gsc"}`,
        };
      });

    opportunities = opportunities.filter((opp) => !looksLikeRedditFragment(opp.niche));
    if (requestedCategories.length > 0) {
      const allowed = new Set(requestedCategories);
      opportunities = opportunities.filter((opp) => allowed.has(opp.site_type));
    }

    opportunities = opportunities.map((opp) => {
      const scoped = applyRequestedMarketAndCategory(opp, requestedCountries, requestedCategories);
      return {
        ...scoped,
        signal_source: `${scoped.signal_source ?? "gsc"}:scan-${scanContextKey}`,
      };
    });

    opportunities = opportunities.map((opp, index) => {
      if ((opp.competitors ?? []).length > 0) return opp;
      const candidateFallback = candidates[index];
      if (!candidateFallback) return opp;
      return {
        ...opp,
        competitors: fallbackOpportunity(candidateFallback).competitors,
      };
    });

    // v2 enrichment: deterministic, no AI cost
    opportunities = opportunities.map((opp) => {
      const launchPlan = buildLaunchPlan({
        niche: opp.niche,
        core_keywords: opp.core_keywords ?? [],
        sample_queries: opp.sample_queries,
        related_questions: opp.serp_evidence?.relatedQuestions ?? [],
      });
      const whyNow = deriveWhyNow({
        signal_source: opp.signal_source,
        momentum_pct: opp.momentum_pct,
        opportunity_type: opp.opportunity_type,
        sample_queries: opp.sample_queries,
        serp_evidence: opp.serp_evidence,
      });
      const domainAvail = (opp.suggested_domains ?? []).map((d) => checkDomainAvailability(d));

      return {
        ...opp,
        launch_plan: launchPlan,
        time_to_rank_months: undefined,
        why_now: whyNow,
        revenue_range: undefined,
        domain_available: domainAvail,
      };
    });

    opportunities = opportunities
      .map((opp) => {
        const quality = opportunityQualityScore(opp);
        return {
          ...opp,
          confidence_score: Math.round((Number(opp.confidence_score || 0) * 0.65) + (quality * 0.35)),
          score_breakdown: {
            ...(opp.score_breakdown ?? {
              growth: 0,
              volume: 0,
              weakness: 0,
              specificity: 0,
              business: 0,
              portfolioDistance: 0,
            }),
            specificity: Math.max(opp.score_breakdown?.specificity ?? 0, quality),
          },
        };
      })
      .filter((opp) => opp.metric_status !== "external_signal_unmeasured")
      .filter(isHighQualityOpportunity)
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))
      .slice(0, 8);

    if (opportunities.length === 0) {
      await sql`DELETE FROM market_opportunities WHERE status IN ('pending', 'rejected') OR status IS NULL`;
      return NextResponse.json({
        success: true,
        opportunities: [],
        keywords_analyzed: mergedRows.length,
        sites_analyzed: sites.length,
        discovery_mode: requestedMode,
        message: "Scanner strict: aucune opportunite assez specifique. Relance avec une autre categorie ou un autre marche.",
      });
    }

    try {
      await sql.transaction(
        [
          sql`DELETE FROM market_opportunities WHERE status IN ('pending', 'rejected') OR status IS NULL`,
          ...opportunities.map((opp) => sql`
            INSERT INTO market_opportunities
            (niche, reason, site_type, core_keywords, monthly_volume, competition, monetization,
             projected_traffic_6m, projected_revenue_6m, suggested_domains, seed_articles,
             target_countries, target_languages, competitors, business_model, success_rate, revenue_timeline, confidence_score,
             signal_source, momentum_pct, average_position, opportunity_type, sample_queries, score_breakdown, serp_evidence,
             launch_plan, time_to_rank_months, why_now, revenue_range, domain_available,
             metric_status, signal_sources, engine_version, volume_source, gsc_impressions_30d)
            VALUES (${opp.niche}, ${opp.reason}, ${opp.site_type}, ${JSON.stringify(opp.core_keywords)},
                    ${opp.monthly_volume}, ${opp.competition}, ${opp.monetization},
                    ${opp.projected_traffic_6m}, ${opp.projected_revenue_6m},
                    ${JSON.stringify(opp.suggested_domains)}, ${JSON.stringify(opp.seed_articles)},
                    ${JSON.stringify(opp.target_countries ?? [])}, ${JSON.stringify(opp.target_languages ?? [])},
                    ${JSON.stringify(opp.competitors ?? [])}, ${JSON.stringify(opp.business_model ?? {})},
                    ${opp.success_rate ?? 0}, ${JSON.stringify(opp.revenue_timeline ?? {})},
                    ${opp.confidence_score}, ${opp.signal_source ?? "gsc"},
                    ${opp.momentum_pct ?? 0}, ${opp.average_position ?? 0},
                    ${opp.opportunity_type ?? "emerging"}, ${JSON.stringify(opp.sample_queries ?? [])},
                    ${JSON.stringify(opp.score_breakdown ?? {})}, ${JSON.stringify(opp.serp_evidence ?? {})},
                    ${JSON.stringify(opp.launch_plan ?? {})}, ${opp.time_to_rank_months ?? null},
                    ${JSON.stringify(opp.why_now ?? [])}, ${JSON.stringify(opp.revenue_range ?? {})},
                    ${JSON.stringify(opp.domain_available ?? [])},
                    ${opp.metric_status ?? "external_signal_unmeasured"},
                    ${JSON.stringify(opp.signal_sources ?? [])},
                    'local-opportunity-v2', ${opp.volume_source ?? null}, ${opp.gsc_impressions_30d ?? 0})
          `),
        ]
      );
    } catch (err) {
      console.error("Failed to store opportunities:", err);
    }

    const persistedRows = await sql`
      SELECT *
      FROM market_opportunities
      WHERE signal_source LIKE ${`%:scan-${scanContextKey}%`}
        AND engine_version = 'local-opportunity-v2'
      ORDER BY confidence_score DESC, created_at DESC
      LIMIT 100
    `;

    return NextResponse.json({
      success: true,
      opportunities: persistedRows,
      keywords_analyzed: mergedRows.length,
      sites_analyzed: sites.length,
      candidate_count: candidates.length,
      external_signals_added: externalRows.length,
      discovery_mode: requestedMode,
      countries: requestedCountries,
      metric_boundaries: {
        monthly_volume: "verified_keyword_planner_import_only",
        gsc_impressions_30d: "observed_search_console_visibility",
        projected_traffic_6m: "not_calculated",
        projected_revenue_6m: "not_calculated",
        time_to_rank_months: "not_calculated",
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}

/**
 * GET /api/opportunities/scan â€” Returns cached opportunities from DB
 */
export async function GET() {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT * FROM market_opportunities
      WHERE engine_version = 'local-opportunity-v2'
      ORDER BY confidence_score DESC, created_at DESC
      LIMIT 100
    `;
    const strictRows = (rows as StoredOpportunity[])
      .filter(isHighQualityOpportunity)
      .sort((a, b) => (Number(b.confidence_score || 0) - Number(a.confidence_score || 0)))
      .slice(0, 30);
    return NextResponse.json({
      success: true,
      opportunities: strictRows,
      message: strictRows.length < rows.length
        ? `${rows.length - strictRows.length} opportunites faibles masquees par le filtre qualite.`
        : undefined,
      metric_boundaries: {
        monthly_volume: "verified_keyword_planner_import_only",
        gsc_impressions_30d: "observed_search_console_visibility",
        projected_traffic_6m: "not_calculated",
        projected_revenue_6m: "not_calculated",
        time_to_rank_months: "not_calculated",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load opportunities", opportunities: [] },
      { status: 500 }
    );
  }
}
