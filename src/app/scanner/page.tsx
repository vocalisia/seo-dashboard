"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowLeft, Loader2, Radar, Rocket, TrendingUp, DollarSign, Globe, Zap, ChevronDown, ChevronRight, Sparkles, Clock } from "lucide-react";
import Link from "next/link";

interface Opportunity {
  id: number;
  niche: string;
  reason: string;
  site_type: string;
  core_keywords: string[];
  monthly_volume: number;
  competition: string;
  monetization: string;
  projected_traffic_6m: number;
  projected_revenue_6m: number;
  suggested_domains: string[];
  seed_articles: string[];
  target_countries?: string[];
  target_languages?: string[];
  competitors?: { url: string; name: string }[];
  success_rate?: number;
  revenue_timeline?: { m1: number; m3: number; m6: number; m12: number };
  business_model?: {
    type: string;
    how_to_monetize: string;
    affiliate_programs?: string[];
    products_to_sell?: string[];
    ad_revenue_estimate?: number;
    affiliate_revenue_estimate?: number;
    product_revenue_estimate?: number;
    tools_needed?: string[];
  };
  confidence_score: number;
  status: string;
  signal_source?: string;
  momentum_pct?: number;
  average_position?: number;
  opportunity_type?: string;
  sample_queries?: string[];
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
  };
  launch_plan?: {
    pillar_topic: string;
    launch_horizon_days: number;
    articles: Array<{
      title: string;
      target_keyword: string;
      intent: string;
      word_count_target: number;
      priority: number;
    }>;
  };
  time_to_rank_months?: number;
  why_now?: Array<{ signal: string; source: string; detail: string }>;
  revenue_range?: {
    m6_low: number;
    m6_high: number;
    m12_low: number;
    m12_high: number;
    currency: string;
    assumption: string;
  };
  domain_available?: Array<{ domain: string; available: string; reason: string }>;
}

interface DeepResearchPayload {
  niche: string;
  keyword: string;
  fetched_at: string;
  summary: string;
  competitors: Array<{
    rank: number;
    url: string;
    host: string;
    title: string;
    estimated_authority: "low" | "medium" | "high";
  }>;
  content_angles: string[];
  content_gaps: string[];
  related_questions: string[];
  related_searches: string[];
  top_pages_extracted: Array<{
    url: string;
    title?: string;
    headings: string[];
    word_count_estimate: number;
  }>;
}

const COUNTRY_FLAG: Record<string, string> = {
  FRA: "🇫🇷", DEU: "🇩🇪", CHE: "🇨🇭", GBR: "🇬🇧", USA: "🇺🇸", BEL: "🇧🇪", CAN: "🇨🇦",
  ESP: "🇪🇸", ITA: "🇮🇹", NLD: "🇳🇱", PRT: "🇵🇹", AUT: "🇦🇹", BRA: "🇧🇷", AUS: "🇦🇺",
  IRL: "🇮🇪", LUX: "🇱🇺", MEX: "🇲🇽", ARG: "🇦🇷", JPN: "🇯🇵", IND: "🇮🇳", SGP: "🇸🇬",
};

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

const COMP_COLOR: Record<string, string> = {
  low: "text-green-400 bg-green-900/30",
  medium: "text-yellow-400 bg-yellow-900/30",
  high: "text-red-400 bg-red-900/30",
};

const TYPE_ICON: Record<string, string> = {
  blog: "📝", magazine: "📰", "e-commerce": "🛒", saas: "💻", directory: "📁",
};

type DiscoveryMode = "A" | "B" | "C";

const COUNTRY_OPTIONS: { code: string; flag: string; label: string }[] = [
  { code: "GLOBAL", flag: "🌍", label: "Global / Anglo" },
  { code: "FR", flag: "🇫🇷", label: "France" },
  { code: "GB", flag: "🇬🇧", label: "United Kingdom" },
  { code: "DE", flag: "🇩🇪", label: "Deutschland" },
  { code: "ES", flag: "🇪🇸", label: "España + LATAM" },
  { code: "IT", flag: "🇮🇹", label: "Italia" },
  { code: "CH", flag: "🇨🇭", label: "Suisse" },
  { code: "CA", flag: "🇨🇦", label: "Canada" },
  { code: "BR", flag: "🇧🇷", label: "Brasil" },
  { code: "JP", flag: "🇯🇵", label: "日本" },
];

const CATEGORY_OPTIONS: { code: string; emoji: string; label: string; hint: string }[] = [
  { code: "ALL", emoji: "🎯", label: "Toutes catégories", hint: "Aucun filtre" },
  { code: "e-commerce", emoji: "🛒", label: "E-commerce", hint: "Produits physiques, dropshipping, marques DTC" },
  { code: "saas", emoji: "💻", label: "SaaS", hint: "Logiciels, outils, abonnements B2B/B2C" },
  { code: "blog", emoji: "📝", label: "Blog", hint: "Contenu informationnel monétisé pubs/affiliation" },
  { code: "magazine", emoji: "📰", label: "Magazine", hint: "Édito haut volume, multi-auteurs" },
  { code: "directory", emoji: "📁", label: "Annuaire", hint: "Listings, lead-gen, comparateurs" },
  { code: "course", emoji: "🎓", label: "Formation", hint: "Cours en ligne, coaching, infoproduits" },
  { code: "marketplace", emoji: "🏪", label: "Marketplace", hint: "Plateformes multi-vendeurs" },
];

const DISCOVERY_MODE_COPY: Record<DiscoveryMode, { title: string; description: string }> = {
  A: {
    title: "Proche de ton portefeuille actuel",
    description: "Priorise les niches proches de tes sites et de tes signaux déjà existants.",
  },
  B: {
    title: "Mix portefeuille + discovery global",
    description: "Mélange tes signaux internes avec de la découverte externe pour sortir des mêmes idées.",
  },
  C: {
    title: "Discovery global pur",
    description: "Cherche partout les opportunités, même loin de ton portefeuille actuel.",
  },
};

export default function ScannerPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState<number | null>(null);
  const [validating, setValidating] = useState<number | null>(null);
  const [validationResults, setValidationResults] = useState<Record<number, {
    verdict: string; verdict_reason: string; attackability_score: number;
    time_to_page1_months: number; content_gaps: string[]; quick_wins: string[];
    strategy_recommendation: string;
  }>>({});
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [loadCompetitorsMsg, setLoadCompetitorsMsg] = useState<string | null>(null);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);
  const [autoLoadProgress, setAutoLoadProgress] = useState<{ current: number; total: number } | null>(null);
  const pausedRef = useRef(false);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("B");
  const [countries, setCountries] = useState<string[]>(["GLOBAL"]);
  const [categories, setCategories] = useState<string[]>(["ALL"]);

  function toggleCountry(code: string) {
    setCountries((prev) => {
      if (code === "GLOBAL") return ["GLOBAL"];
      const without = prev.filter((c) => c !== "GLOBAL");
      if (without.includes(code)) {
        const next = without.filter((c) => c !== code);
        return next.length === 0 ? ["GLOBAL"] : next;
      }
      return [...without, code];
    });
  }

  function toggleCategory(code: string) {
    setCategories((prev) => {
      if (code === "ALL") return ["ALL"];
      const without = prev.filter((c) => c !== "ALL");
      if (without.includes(code)) {
        const next = without.filter((c) => c !== code);
        return next.length === 0 ? ["ALL"] : next;
      }
      return [...without, code];
    });
  }
  const [translations, setTranslations] = useState<Record<number, {
    niche?: string; reason?: string; seed_articles?: string[]; sample_queries?: string[];
    business_model_type?: string; business_model_how_to_monetize?: string;
  }>>({});
  const [translating, setTranslating] = useState<number | null>(null);
  const [loadingCompetitors, setLoadingCompetitors] = useState<number | null>(null);
  const [competitorsCache, setCompetitorsCache] = useState<Record<number, { url: string; name: string }[]>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [deepResearch, setDeepResearch] = useState<Record<number, DeepResearchPayload>>({});
  const [loadingDeepResearch, setLoadingDeepResearch] = useState<number | null>(null);
  const [launching, setLaunching] = useState<number | null>(null);
  const [launchResults, setLaunchResults] = useState<Record<number, { site_url: string; planned_articles: number; seeded_keywords: number; message: string }>>({});

  function toggleExpand(id: number) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function runDeepResearch(opp: Opportunity) {
    setLoadingDeepResearch(opp.id);
    setDeployMsg(null);
    try {
      const keyword = (opp.core_keywords?.[0] ?? opp.niche).trim();
      const res = await fetch("/api/scanner/deep-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: opp.niche, keyword }),
      });
      const d = await res.json() as { success: boolean; research?: DeepResearchPayload; error?: string };
      if (d.success && d.research) {
        setDeepResearch((prev) => ({ ...prev, [opp.id]: d.research! }));
      } else {
        setDeployMsg(d.error ?? "Deep research a échoué.");
      }
    } catch {
      setDeployMsg("Erreur réseau pendant le deep research.");
    } finally {
      setLoadingDeepResearch(null);
    }
  }

  async function launchNiche(opp: Opportunity) {
    setLaunching(opp.id);
    setDeployMsg(null);
    try {
      const res = await fetch("/api/scanner/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: opp.id, domain: opp.suggested_domains?.[0] }),
      });
      const d = await res.json() as {
        success: boolean; site_url?: string; planned_articles?: number;
        seeded_keywords?: number; message?: string; error?: string;
      };
      if (d.success && d.site_url) {
        setLaunchResults((prev) => ({
          ...prev,
          [opp.id]: {
            site_url: d.site_url!,
            planned_articles: d.planned_articles ?? 0,
            seeded_keywords: d.seeded_keywords ?? 0,
            message: d.message ?? "Stub créé",
          },
        }));
        await fetchCached();
      } else {
        setDeployMsg(d.error ?? "Le lancement a échoué.");
      }
    } catch {
      setDeployMsg("Erreur réseau pendant le lancement.");
    } finally {
      setLaunching(null);
    }
  }

  async function loadCompetitors(oppId: number) {
    setLoadingCompetitors(oppId);
    setLoadCompetitorsMsg(null);
    try {
      const res = await fetch("/api/opportunities/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: oppId }),
      });
      const d = await res.json();
      if (d.success && Array.isArray(d.competitors)) {
        setCompetitorsCache((prev) => ({ ...prev, [oppId]: d.competitors }));
        if (d.competitors.length === 0) {
          setLoadCompetitorsMsg("Aucun concurrent trouvé via Google. Réessaie ou regarde manuellement.");
        }
      } else {
        setLoadCompetitorsMsg(d.error ?? "Échec du chargement des concurrents.");
      }
    } catch {
      setLoadCompetitorsMsg("Erreur réseau pendant le chargement des concurrents.");
    } finally {
      setLoadingCompetitors(null);
    }
  }

  async function translateOpp(oppId: number) {
    setTranslating(oppId);
    setTranslateMsg(null);
    try {
      const res = await fetch("/api/opportunities/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: oppId, target: "fr" }),
      });
      const d = await res.json();
      if (d.success && d.translated) {
        setTranslations((prev) => ({ ...prev, [oppId]: d.translated }));
      } else {
        setTranslateMsg("La traduction a échoué.");
      }
    } catch {
      setTranslateMsg("Erreur réseau pendant la traduction.");
    } finally {
      setTranslating(null);
    }
  }

  function isVolumeEstimated(opp: Opportunity): boolean {
    const src = opp.signal_source ?? "";
    return src.includes("global-discovery") || src.includes("portfolio+global");
  }

  function googleSerpUrl(opp: Opportunity): string {
    const kw = (opp.core_keywords?.[0]) || opp.niche;
    return `https://www.google.com/search?q=${encodeURIComponent(kw)}`;
  }

  useEffect(() => { void fetchCached(); }, []);

  useEffect(() => {
    const missing = opportunities
      .filter((o) => (!o.competitors || o.competitors.length === 0) && !competitorsCache[o.id] && loadingCompetitors !== o.id)
      .slice(0, 8);
    if (missing.length === 0) return;

    pausedRef.current = false;
    let cancelled = false;
    setAutoLoadProgress({ current: 0, total: missing.length });

    (async () => {
      for (let i = 0; i < missing.length; i++) {
        if (cancelled || pausedRef.current) break;
        const opp = missing[i];
        setAutoLoadProgress({ current: i + 1, total: missing.length });
        try {
          const res = await fetch("/api/opportunities/competitors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ opportunity_id: opp.id }),
          });
          const d = await res.json();
          if (!cancelled && d.success && Array.isArray(d.competitors) && d.competitors.length > 0) {
            setCompetitorsCache((prev) => ({ ...prev, [opp.id]: d.competitors }));
          }
        } catch {
          // skip silently
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      if (!cancelled) setAutoLoadProgress(null);
    })();

    return () => {
      cancelled = true;
      setAutoLoadProgress(null);
    };
  }, [opportunities]);

  async function fetchCached() {
    try {
      const res = await fetch("/api/opportunities/scan");
      if (!res.ok) return;
      const d = await res.json() as { opportunities?: Opportunity[] };
      setOpportunities(d.opportunities ?? []);
    } catch { /* ignore */ }
  }

  async function runScan() {
    setLoading(true);
    setDeployMsg(null);
    try {
      const res = await fetch("/api/opportunities/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discovery_mode: discoveryMode, countries, categories }),
      });
      if (!res.ok) {
        setDeployMsg("Le scan a échoué.");
        return;
      }
      const d = await res.json() as { opportunities?: Opportunity[] };
      setOpportunities(d.opportunities ?? []);
    } catch {
      setDeployMsg("Erreur réseau pendant le scan.");
    } finally {
      setLoading(false);
    }
  }

  async function validateNiche(oppId: number) {
    setValidating(oppId);
    try {
      const res = await fetch("/api/opportunities/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: oppId }),
      });
      if (!res.ok) {
        setDeployMsg(`Validation échouée (${res.status}).`);
        return;
      }
      const d = await res.json();
      if (d.success) {
        setValidationResults((prev) => ({ ...prev, [oppId]: d }));
      } else {
        setDeployMsg("La validation a échoué.");
      }
    } catch {
      setDeployMsg("Erreur réseau pendant la validation.");
    } finally {
      setValidating(null);
    }
  }

  async function deploySite(opp: Opportunity) {
    const domain = opp.suggested_domains?.[0];
    if (!domain) {
      setDeployMsg("Aucun domaine suggéré pour cette opportunité.");
      return;
    }
    setDeploying(opp.id);
    setDeployMsg(null);
    try {
      const res = await fetch("/api/opportunities/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: opp.id, domain }),
      });
      const d = await res.json() as { success: boolean; message?: string; error?: string };
      setDeployMsg(d.success ? d.message ?? "Déployé!" : d.error ?? "Erreur");
    } catch { setDeployMsg("Erreur réseau"); }
    try {
      await fetchCached();
    } catch {
      // keep the deploy result message even if refresh fails
    }
    setDeploying(null);
  }

  const totalRevenue = opportunities.reduce((s, o) => s + (o.projected_revenue_6m || 0), 0);
  const totalTraffic = opportunities.reduce((s, o) => s + (o.projected_traffic_6m || 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Radar className="w-5 h-5 text-cyan-400" />
        <h1 className="text-xl font-semibold">Scanner d&apos;Opportunités</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Scan button */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h2 className="font-medium text-white">Détection prédictive de niches</h2>
              <p className="text-xs text-gray-500 mt-1">
                Analyse tes données GSC + signaux externes pour trouver des niches rentables où tu n&apos;as pas encore de site dédié.
                Volume minimum: 5K recherches/mois. Projection trafic et revenus à 6 mois.
              </p>
            </div>
            <button
              onClick={runScan}
              disabled={loading}
              className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
              {loading ? "Scan en cours..." : "Scanner le marché"}
            </button>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <div className="text-xs font-medium text-gray-400 mb-2">Type de business recherché</div>
            <div className="flex flex-wrap gap-2 mb-4">
              {CATEGORY_OPTIONS.map((opt) => {
                const active = categories.includes(opt.code);
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => toggleCategory(opt.code)}
                    title={opt.hint}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-200"
                        : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <span className="text-base leading-none">{opt.emoji}</span>
                    <span>{opt.label}</span>
                    {active && <span className="text-fuchsia-300 text-[10px]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <div className="text-xs font-medium text-gray-400 mb-2">Marché ciblé</div>
            <div className="flex flex-wrap gap-2 mb-4">
              {COUNTRY_OPTIONS.map((opt) => {
                const active = countries.includes(opt.code);
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => toggleCountry(opt.code)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                      active
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                        : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <span className="text-base leading-none">{opt.flag}</span>
                    <span>{opt.label}</span>
                    {active && <span className="text-emerald-300 text-[10px]">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-gray-400 mb-2">Mode de découverte</div>
            <div className="grid grid-cols-3 gap-3">
              {(["A", "B", "C"] as DiscoveryMode[]).map((mode) => {
                const active = discoveryMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDiscoveryMode(mode)}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-cyan-500 bg-cyan-500/10"
                        : "border-gray-700 bg-gray-800/40 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-bold ${active ? "text-cyan-300" : "text-gray-200"}`}>{mode}</span>
                      <span className={`text-sm font-medium ${active ? "text-white" : "text-gray-300"}`}>
                        {DISCOVERY_MODE_COPY[mode].title}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{DISCOVERY_MODE_COPY[mode].description}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-cyan-300 mt-3">
              Mode actif: <code>{discoveryMode}</code> — {DISCOVERY_MODE_COPY[discoveryMode].title}
            </p>
          </div>
        </div>

        {/* Summary */}
        {opportunities.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Opportunités détectées</div>
              <div className="text-3xl font-bold text-cyan-400 mt-1">{opportunities.length}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Trafic projeté total (6 mois)</div>
              <div className="text-3xl font-bold text-blue-400 mt-1">{totalTraffic.toLocaleString()}/mois</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Revenus projetés total (6 mois)</div>
              <div className="text-3xl font-bold text-green-400 mt-1">{totalRevenue.toLocaleString()}€/mois</div>
            </div>
          </div>
        )}

        {/* Auto-load progress */}
        {autoLoadProgress && (
          <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-300">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400 flex-shrink-0" />
            <span>Chargement concurrents {autoLoadProgress.current}/{autoLoadProgress.total}...</span>
            <button
              onClick={() => { pausedRef.current = true; setAutoLoadProgress(null); }}
              className="ml-auto px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300"
            >
              Pause
            </button>
          </div>
        )}

        {/* Deploy/scan result */}
        {deployMsg && (
          <div className="bg-blue-900/30 border border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-300">
            {deployMsg}
          </div>
        )}
        {loadCompetitorsMsg && (
          <div className="bg-orange-900/30 border border-orange-800 rounded-lg px-4 py-3 text-sm text-orange-300">
            {loadCompetitorsMsg}
          </div>
        )}
        {translateMsg && (
          <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg px-4 py-3 text-sm text-yellow-300">
            {translateMsg}
          </div>
        )}

        {/* Opportunities */}
        {opportunities.length > 0 && (
          <div className="space-y-4">
            {opportunities.map((opp, idx) => (
              <div key={opp.id ?? `opp-${idx}`} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xl">{TYPE_ICON[opp.site_type] ?? "🌐"}</span>
                      <h3 className="text-lg font-bold text-white">{translations[opp.id]?.niche ?? opp.niche}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${COMP_COLOR[opp.competition] ?? ""}`}>
                        {opp.competition}
                      </span>
                      {translations[opp.id] && (
                        <span className="text-[10px] uppercase tracking-wider bg-cyan-900/40 text-cyan-300 rounded px-1.5 py-0.5">
                          🇫🇷 traduit
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">{translations[opp.id]?.reason ?? opp.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={() => translateOpp(opp.id)}
                        disabled={translating === opp.id}
                        title="Traduire en français"
                        className="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/40 border border-blue-700 text-blue-300 rounded flex items-center gap-1 disabled:opacity-50"
                      >
                        {translating === opp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>🇫🇷</span>}
                        {translations[opp.id] ? "↻ FR" : "Traduire"}
                      </button>
                      <a
                        href={googleSerpUrl(opp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Voir la SERP Google sur ce mot-clé"
                        className="px-2 py-1 text-xs bg-violet-600/20 hover:bg-violet-600/40 border border-violet-700 text-violet-300 rounded flex items-center gap-1"
                      >
                        🔎 Voir SERP
                      </a>
                    </div>
                    <div className="text-center bg-gray-800 rounded-lg px-4 py-2">
                      <div className="text-2xl font-bold text-cyan-400">{opp.confidence_score}</div>
                      <div className="text-[10px] text-gray-500">Confiance</div>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Globe className="w-3 h-3" /> Volume/mois
                      {isVolumeEstimated(opp) && (
                        <span className="ml-1 text-[9px] uppercase tracking-wider bg-amber-900/40 text-amber-300 rounded px-1 py-0.5"
                          title="Volume estimé à partir de signaux externes (Reddit/HN/PH/Trends), pas de données GSC réelles">
                          estimé
                        </span>
                      )}
                    </div>
                    <div className="text-lg font-bold text-white">{(opp.monthly_volume || 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400"><TrendingUp className="w-3 h-3" /> Trafic 6m</div>
                    <div className="text-lg font-bold text-blue-400">{(opp.projected_traffic_6m || 0).toLocaleString()}/mois</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400"><DollarSign className="w-3 h-3" /> Revenus 6m</div>
                    <div className="text-lg font-bold text-green-400">{(opp.projected_revenue_6m || 0).toLocaleString()}€/mois</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400"><Zap className="w-3 h-3" /> Monétisation</div>
                    <div className="text-sm font-bold text-yellow-400 mt-1">{opp.monetization}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-400">Signal source</div>
                    <div className="text-sm font-semibold text-cyan-300 mt-1">{opp.signal_source ?? "gsc"}</div>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-400">Momentum</div>
                    <div className="text-sm font-semibold text-emerald-300 mt-1">
                      {typeof opp.momentum_pct === "number" ? `${opp.momentum_pct.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-400">Type</div>
                    <div className="text-sm font-semibold text-violet-300 mt-1">{opp.opportunity_type ?? "emerging"}</div>
                  </div>
                </div>

                {/* Success rate + Revenue timeline */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {/* Success rate bar */}
                  <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-400">Taux de succès SEO</span>
                      <span className={`font-bold ${(opp.success_rate ?? 0) >= 70 ? "text-green-400" : (opp.success_rate ?? 0) >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                        {opp.success_rate ?? "—"}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{
                        width: `${opp.success_rate ?? 0}%`,
                        backgroundColor: (opp.success_rate ?? 0) >= 70 ? "#22c55e" : (opp.success_rate ?? 0) >= 40 ? "#eab308" : "#ef4444"
                      }} />
                    </div>
                  </div>

                  {/* Revenue timeline */}
                  {opp.revenue_timeline && (
                    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                      <div className="text-xs text-gray-400 mb-1">Revenus projetés (€/mois)</div>
                      <div className="flex items-end gap-1 h-6">
                        {[
                          { label: "M1", val: opp.revenue_timeline.m1 },
                          { label: "M3", val: opp.revenue_timeline.m3 },
                          { label: "M6", val: opp.revenue_timeline.m6 },
                          { label: "M12", val: opp.revenue_timeline.m12 },
                        ].map((p) => {
                          const max = Math.max(opp.revenue_timeline!.m12, 1);
                          const pct = Math.max(4, (p.val / max) * 100);
                          return (
                            <div key={p.label} className="flex-1 flex flex-col items-center">
                              <div className="text-[9px] text-green-400 font-medium">{p.val > 0 ? `${p.val}€` : "—"}</div>
                              <div className="w-full bg-green-500/40 rounded-t-sm" style={{ height: `${pct}%`, minHeight: "2px" }} />
                              <div className="text-[8px] text-gray-500 mt-0.5">{p.label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Keywords */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(opp.core_keywords || []).map((kw, i) => (
                    <span key={i} className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300">{kw}</span>
                  ))}
                </div>

                {opp.sample_queries && opp.sample_queries.length > 0 && (
                  <details className="mb-4">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                      📡 Requêtes sources ({opp.sample_queries.length})
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(translations[opp.id]?.sample_queries ?? opp.sample_queries).map((query, i) => (
                        <span key={i} className="bg-cyan-900/20 border border-cyan-900/40 rounded px-2 py-0.5 text-xs text-cyan-200">
                          {query}
                        </span>
                      ))}
                    </div>
                  </details>
                )}

                {opp.score_breakdown && (
                  <details className="mb-4">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                      🧮 Décomposition du score
                    </summary>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[
                        ["Growth", opp.score_breakdown.growth],
                        ["Volume", opp.score_breakdown.volume],
                        ["Weakness", opp.score_breakdown.weakness],
                        ["Specificity", opp.score_breakdown.specificity],
                        ["Business", opp.score_breakdown.business],
                        ["Distance", opp.score_breakdown.portfolioDistance],
                      ].map(([label, value]) => (
                        <div key={label} className="bg-gray-800/40 rounded px-3 py-2">
                          <div className="text-[10px] text-gray-500">{label}</div>
                          <div className="text-sm font-semibold text-white mt-1">
                            {typeof value === "number" ? value.toFixed(2) : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {opp.serp_evidence &&
                  (
                    (opp.serp_evidence.relatedQuestions?.length ?? 0) > 0 ||
                    (opp.serp_evidence.relatedSearches?.length ?? 0) > 0 ||
                    (opp.serp_evidence.resultTitles?.length ?? 0) > 0
                  ) && (
                  <details className="mb-4">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                      🔎 Preuves SERP
                    </summary>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div className="bg-gray-800/30 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 mb-2">Questions liées</div>
                        <div className="space-y-1">
                          {(opp.serp_evidence.relatedQuestions || []).slice(0, 5).map((item, i) => (
                            <div key={i} className="text-xs text-cyan-200">{item}</div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-gray-800/30 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 mb-2">Recherches associées</div>
                        <div className="space-y-1">
                          {(opp.serp_evidence.relatedSearches || []).slice(0, 5).map((item, i) => (
                            <div key={i} className="text-xs text-emerald-200">{item}</div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-gray-800/30 rounded-lg p-3">
                        <div className="text-[10px] text-gray-500 mb-2">Titres SERP observés</div>
                        <div className="space-y-1">
                          {(opp.serp_evidence.resultTitles || []).slice(0, 5).map((item, i) => (
                            <div key={i} className="text-xs text-violet-200">{item}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                )}

                {/* Business Model */}
                {opp.business_model && (
                  <div className="bg-gradient-to-r from-gray-800/80 to-gray-800/40 border border-gray-700 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">💼</span>
                      <span className="text-sm font-semibold text-white">
                        {translations[opp.id]?.business_model_type ?? opp.business_model.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mb-3">
                      {translations[opp.id]?.business_model_how_to_monetize ?? opp.business_model.how_to_monetize}
                    </p>

                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {(opp.business_model.ad_revenue_estimate ?? 0) > 0 && (
                        <div className="bg-gray-900/60 rounded px-2 py-1.5 text-center">
                          <div className="text-sm font-bold text-blue-400">{opp.business_model.ad_revenue_estimate}€</div>
                          <div className="text-[9px] text-gray-500">Ads/mois</div>
                        </div>
                      )}
                      {(opp.business_model.affiliate_revenue_estimate ?? 0) > 0 && (
                        <div className="bg-gray-900/60 rounded px-2 py-1.5 text-center">
                          <div className="text-sm font-bold text-green-400">{opp.business_model.affiliate_revenue_estimate}€</div>
                          <div className="text-[9px] text-gray-500">Affiliation/mois</div>
                        </div>
                      )}
                      {(opp.business_model.product_revenue_estimate ?? 0) > 0 && (
                        <div className="bg-gray-900/60 rounded px-2 py-1.5 text-center">
                          <div className="text-sm font-bold text-yellow-400">{opp.business_model.product_revenue_estimate}€</div>
                          <div className="text-[9px] text-gray-500">Produits/mois</div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs">
                      {opp.business_model.affiliate_programs && opp.business_model.affiliate_programs.length > 0 && (
                        <div>
                          <span className="text-gray-500">Affiliations: </span>
                          {opp.business_model.affiliate_programs.map((a, i) => (
                            <span key={i} className="text-green-400 bg-green-900/20 rounded px-1.5 py-0.5 mr-1">{a}</span>
                          ))}
                        </div>
                      )}
                      {opp.business_model.products_to_sell && opp.business_model.products_to_sell.length > 0 && (
                        <div>
                          <span className="text-gray-500">Produits: </span>
                          {opp.business_model.products_to_sell.map((p, i) => (
                            <span key={i} className="text-yellow-400 bg-yellow-900/20 rounded px-1.5 py-0.5 mr-1">{p}</span>
                          ))}
                        </div>
                      )}
                      {opp.business_model.tools_needed && opp.business_model.tools_needed.length > 0 && (
                        <div>
                          <span className="text-gray-500">Outils: </span>
                          {opp.business_model.tools_needed.map((t, i) => (
                            <span key={i} className="text-gray-300 bg-gray-800 rounded px-1.5 py-0.5 mr-1">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Countries + Languages */}
                <div className="flex flex-wrap gap-4 mb-3">
                  {opp.target_countries && opp.target_countries.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-gray-500">Pays:</span>
                      {opp.target_countries.map((c, i) => (
                        <span key={i} className="text-base" title={c}>{COUNTRY_FLAG[c] ?? c}</span>
                      ))}
                    </div>
                  )}
                  {opp.target_languages && opp.target_languages.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-gray-500">Langues:</span>
                      {opp.target_languages.map((l, i) => (
                        <span key={i} className="bg-gray-800 rounded px-1.5 py-0.5">
                          {LANG_FLAG[l] ?? ""} {l.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Competitors */}
                {(() => {
                  const competitors = competitorsCache[opp.id] ?? opp.competitors ?? [];
                  return (
                    <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
                      <span className="text-gray-500">Concurrents:</span>
                      {competitors.length > 0 ? (
                        competitors.map((c, i) => (
                          <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
                            className="text-red-400 bg-red-900/20 hover:bg-red-900/40 rounded px-2 py-0.5 underline decoration-red-800 hover:decoration-red-400 transition-colors">
                            {c.name || c.url.replace(/^https?:\/\//, '').split('/')[0]}
                          </a>
                        ))
                      ) : (
                        <span className="text-gray-600 italic">aucun pour l&apos;instant</span>
                      )}
                      <button
                        onClick={() => loadCompetitors(opp.id)}
                        disabled={loadingCompetitors === opp.id}
                        className="ml-1 px-2 py-0.5 bg-orange-600/20 hover:bg-orange-600/40 border border-orange-700 text-orange-300 rounded text-xs flex items-center gap-1 disabled:opacity-50"
                        title="Scrape Google pour récupérer les vrais concurrents"
                      >
                        {loadingCompetitors === opp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>🌐</span>}
                        {competitors.length > 0 ? "↻ Actualiser" : "Charger"}
                      </button>
                    </div>
                  );
                })()}

                {/* Domains */}
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <span className="text-gray-500">Domaines suggérés:</span>
                  {(opp.suggested_domains || []).map((d, i) => (
                    <a key={i} href={`https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(d)}`} target="_blank" rel="noopener noreferrer"
                      className="text-cyan-400 bg-cyan-900/20 hover:bg-cyan-900/40 rounded px-2 py-0.5 underline decoration-cyan-800 hover:decoration-cyan-400 transition-colors"
                      title="Vérifier disponibilité + acheter">
                      {d} ↗
                    </a>
                  ))}
                </div>

                {/* Seed articles */}
                <details className="mb-4">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                    📝 {(opp.seed_articles || []).length} articles de démarrage
                  </summary>
                  <div className="mt-2 space-y-1">
                    {(translations[opp.id]?.seed_articles ?? opp.seed_articles ?? []).map((title, i) => (
                      <div key={i} className="text-xs text-gray-400 bg-gray-800/30 rounded px-3 py-1.5">{title}</div>
                    ))}
                  </div>
                </details>

                {/* Validation result */}
                {validationResults[opp.id] && (
                  <div className={`mb-3 rounded-xl border p-4 ${
                    validationResults[opp.id].verdict === "GO" ? "bg-green-900/20 border-green-700" :
                    validationResults[opp.id].verdict === "RISKY" ? "bg-yellow-900/20 border-yellow-700" :
                    "bg-red-900/20 border-red-700"
                  }`}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-2xl font-black ${
                        validationResults[opp.id].verdict === "GO" ? "text-green-400" :
                        validationResults[opp.id].verdict === "RISKY" ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {validationResults[opp.id].verdict === "GO" ? "✅ GO" :
                         validationResults[opp.id].verdict === "RISKY" ? "⚠️ RISKY" : "🛑 NO-GO"}
                      </span>
                      <div className="bg-gray-800 rounded-lg px-3 py-1 text-center">
                        <div className="text-lg font-bold text-white">{validationResults[opp.id].attackability_score}/100</div>
                        <div className="text-[10px] text-gray-500">Attaquabilité</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg px-3 py-1 text-center">
                        <div className="text-lg font-bold text-white">{validationResults[opp.id].time_to_page1_months} mois</div>
                        <div className="text-[10px] text-gray-500">→ Page 1</div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-300 mb-2">{validationResults[opp.id].verdict_reason}</p>
                    {validationResults[opp.id].quick_wins?.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs text-green-400 font-medium mb-1">Quick wins:</div>
                        {validationResults[opp.id].quick_wins.map((w, i) => (
                          <div key={i} className="text-xs text-gray-400 pl-2">→ {w}</div>
                        ))}
                      </div>
                    )}
                    {validationResults[opp.id].content_gaps?.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs text-blue-400 font-medium mb-1">Content gaps:</div>
                        {validationResults[opp.id].content_gaps.map((g, i) => (
                          <div key={i} className="text-xs text-gray-400 pl-2">→ {g}</div>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-yellow-300 bg-yellow-900/20 rounded px-2 py-1 mt-1">
                      💡 {validationResults[opp.id].strategy_recommendation}
                    </div>
                  </div>
                )}

                {/* v2 enrichment quick row */}
                {(opp.time_to_rank_months || opp.revenue_range || (opp.why_now && opp.why_now.length > 0)) && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {typeof opp.time_to_rank_months === "number" && (
                      <div className="bg-gray-800/40 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-cyan-400" />
                        <div>
                          <div className="text-[10px] text-gray-500">Time to rank</div>
                          <div className="text-sm font-semibold text-cyan-300">{opp.time_to_rank_months} mois</div>
                        </div>
                      </div>
                    )}
                    {opp.revenue_range && (
                      <div className="bg-gray-800/40 rounded-lg px-3 py-2" title={opp.revenue_range.assumption}>
                        <div className="text-[10px] text-gray-500">Revenus 6m (range)</div>
                        <div className="text-sm font-semibold text-green-300">
                          {opp.revenue_range.m6_low.toLocaleString()}–{opp.revenue_range.m6_high.toLocaleString()}€/mois
                        </div>
                      </div>
                    )}
                    {opp.why_now && opp.why_now.length > 0 && (
                      <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                        <div className="text-[10px] text-gray-500">Why now</div>
                        <div className="text-xs font-semibold text-amber-300 truncate" title={opp.why_now.map(s => s.signal).join(" • ")}>
                          {opp.why_now[0].signal}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Expandable detail panel */}
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(opp.id)}
                    className="flex items-center gap-2 text-xs text-gray-400 hover:text-cyan-300 transition"
                  >
                    {expanded[opp.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span>{expanded[opp.id] ? "Replier" : "Voir détail SERP + plan de lancement"}</span>
                  </button>

                  {expanded[opp.id] && (
                    <div className="mt-3 space-y-4 rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                      {/* Why now full list */}
                      {opp.why_now && opp.why_now.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Pourquoi maintenant
                          </div>
                          <div className="space-y-1">
                            {opp.why_now.map((s, i) => (
                              <div key={i} className="text-xs text-gray-300 flex items-start gap-2">
                                <span className="text-[10px] uppercase tracking-wider bg-amber-900/30 text-amber-300 rounded px-1.5 py-0.5 flex-shrink-0">{s.source}</span>
                                <span>{s.signal} <span className="text-gray-500">— {s.detail}</span></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Domain availability */}
                      {opp.domain_available && opp.domain_available.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-cyan-300 mb-2">Disponibilité domaines (heuristique)</div>
                          <div className="space-y-1">
                            {opp.domain_available.map((d, i) => {
                              const color = d.available === "likely" ? "text-green-400" : d.available === "likely_taken" ? "text-red-400" : "text-gray-400";
                              const label = d.available === "likely" ? "✓ probablement libre" : d.available === "likely_taken" ? "✗ probablement pris" : "? à vérifier";
                              return (
                                <div key={i} className="text-xs flex items-center gap-2">
                                  <code className="bg-gray-800 rounded px-1.5 py-0.5">{d.domain}</code>
                                  <span className={color}>{label}</span>
                                  <span className="text-gray-500">— {d.reason}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Revenue range detail */}
                      {opp.revenue_range && (
                        <div>
                          <div className="text-xs font-semibold text-green-300 mb-2">Fourchette revenus (heuristique)</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-gray-800/40 rounded px-2 py-1">
                              <span className="text-gray-500">6 mois: </span>
                              <span className="text-green-400 font-semibold">
                                {opp.revenue_range.m6_low.toLocaleString()}–{opp.revenue_range.m6_high.toLocaleString()}€/mois
                              </span>
                            </div>
                            <div className="bg-gray-800/40 rounded px-2 py-1">
                              <span className="text-gray-500">12 mois: </span>
                              <span className="text-green-400 font-semibold">
                                {opp.revenue_range.m12_low.toLocaleString()}–{opp.revenue_range.m12_high.toLocaleString()}€/mois
                              </span>
                            </div>
                          </div>
                          <div className="text-[10px] text-gray-500 mt-1">{opp.revenue_range.assumption}</div>
                        </div>
                      )}

                      {/* Launch plan */}
                      {opp.launch_plan && opp.launch_plan.articles && opp.launch_plan.articles.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-violet-300 mb-2">
                            Plan de lancement ({opp.launch_plan.articles.length} articles sur {opp.launch_plan.launch_horizon_days}j)
                          </div>
                          <div className="space-y-2">
                            {opp.launch_plan.articles.map((a, i) => (
                              <div key={i} className="bg-gray-800/40 rounded-lg px-3 py-2 text-xs">
                                <div className="flex items-start gap-2">
                                  <span className="text-[10px] uppercase tracking-wider bg-violet-900/30 text-violet-300 rounded px-1.5 py-0.5 flex-shrink-0">
                                    P{a.priority}
                                  </span>
                                  <div className="flex-1">
                                    <div className="text-white font-medium">{a.title}</div>
                                    <div className="text-gray-500 mt-0.5">
                                      KW: <span className="text-cyan-300">{a.target_keyword}</span> ·
                                      {" "}{a.intent} ·
                                      {" "}{a.word_count_target.toLocaleString()} mots
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Deep research */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-fuchsia-300">Deep research SERP (top 10 + extraction top 3)</div>
                          <button
                            type="button"
                            onClick={() => runDeepResearch(opp)}
                            disabled={loadingDeepResearch === opp.id}
                            className="px-2 py-1 text-xs bg-fuchsia-600/20 hover:bg-fuchsia-600/40 border border-fuchsia-700 text-fuchsia-300 rounded flex items-center gap-1 disabled:opacity-50"
                          >
                            {loadingDeepResearch === opp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>🔬</span>}
                            {deepResearch[opp.id] ? "↻ Re-scanner" : "Lancer deep research"}
                          </button>
                        </div>

                        {deepResearch[opp.id] && (
                          <div className="space-y-3">
                            <div className="text-[11px] text-gray-400">{deepResearch[opp.id].summary}</div>

                            {/* Top 10 competitors */}
                            {deepResearch[opp.id].competitors.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Top 10 SERP</div>
                                <div className="space-y-1">
                                  {deepResearch[opp.id].competitors.slice(0, 10).map((c, i) => {
                                    const authColor = c.estimated_authority === "high" ? "text-red-400" : c.estimated_authority === "medium" ? "text-yellow-400" : "text-green-400";
                                    return (
                                      <div key={i} className="text-xs flex items-center gap-2">
                                        <span className="text-gray-500 w-5 text-right">#{c.rank}</span>
                                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline truncate flex-1">
                                          {c.host}
                                        </a>
                                        <span className={`text-[10px] ${authColor}`}>{c.estimated_authority}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Content angles */}
                            {deepResearch[opp.id].content_angles.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Angles déjà couverts</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {deepResearch[opp.id].content_angles.map((a, i) => (
                                    <span key={i} className="text-xs bg-gray-800 text-gray-300 rounded px-2 py-0.5">{a}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Content gaps */}
                            {deepResearch[opp.id].content_gaps.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Gaps détectés (questions PAA non couvertes)</div>
                                <div className="space-y-0.5">
                                  {deepResearch[opp.id].content_gaps.map((g, i) => (
                                    <div key={i} className="text-xs text-amber-200">→ {g}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Launch result */}
                      {launchResults[opp.id] && (
                        <div className="bg-green-900/20 border border-green-700 rounded-lg p-3 text-xs text-green-200">
                          <div className="font-semibold mb-1">✓ Lancement stub créé</div>
                          <div>Site: <code className="bg-gray-800 rounded px-1">{launchResults[opp.id].site_url}</code></div>
                          <div>{launchResults[opp.id].planned_articles} articles planifiés · {launchResults[opp.id].seeded_keywords} keywords trackés</div>
                          <div className="text-gray-400 mt-1">{launchResults[opp.id].message}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => launchNiche(opp)}
                    disabled={launching === opp.id || opp.status === "deployed"}
                    className="px-4 py-2 bg-violet-600/20 hover:bg-violet-600/40 border border-violet-700 text-violet-300 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                    title="Crée un stub site + content_plan + tracked_keywords (pas de GitHub repo)"
                  >
                    {launching === opp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {launching === opp.id ? "Stub en cours..." : "Launch this niche"}
                  </button>
                </div>

                {/* Existing action buttons (deploy/validate) */}
                <div className="flex gap-3 mt-3">
                  {/* Validate button */}
                  {!validationResults[opp.id] && (
                    <button
                      onClick={() => validateNiche(opp.id)}
                      disabled={validating === opp.id}
                      className="px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/40 border border-yellow-700 text-yellow-400 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                    >
                      {validating === opp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>🔍</span>}
                      {validating === opp.id ? "Analyse SERP..." : "Valider la niche"}
                    </button>
                  )}

                  {/* Deploy button */}
                  {opp.status === "pending" ? (
                    <button
                      onClick={() => deploySite(opp)}
                      disabled={deploying === opp.id}
                      className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
                    >
                      {deploying === opp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                      {deploying === opp.id ? "Création en cours..." : "Créer ce site"}
                    </button>
                  ) : (
                    <span className="text-xs text-green-400 bg-green-900/20 rounded px-3 py-1.5">✅ Déployé</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && opportunities.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <Radar className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500">Clique &quot;Scanner le marché&quot; pour détecter les opportunités</div>
          </div>
        )}
      </div>
    </div>
  );
}
