"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Radar, Rocket, TrendingUp, DollarSign, Globe, Zap } from "lucide-react";
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
  confidence_score: number;
  status: string;
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
  const [deployResult, setDeployResult] = useState<string | null>(null);

  useEffect(() => { void fetchCached(); }, []);

  async function fetchCached() {
    try {
      const res = await fetch("/api/opportunities/scan");
      const d = await res.json() as { opportunities?: Opportunity[] };
      setOpportunities(d.opportunities ?? []);
    } catch { /* ignore */ }
  }

  async function runScan() {
    setLoading(true);
    try {
      const res = await fetch("/api/opportunities/scan", { method: "POST" });
      const d = await res.json() as { opportunities?: Opportunity[] };
      setOpportunities(d.opportunities ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function validateNiche(oppId: number) {
    setValidating(oppId);
    try {
      const res = await fetch("/api/opportunities/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: oppId }),
      });
      const d = await res.json();
      if (d.success) {
        setValidationResults((prev) => ({ ...prev, [oppId]: d }));
      }
    } catch { /* ignore */ }
    setValidating(null);
  }

  async function deploySite(opp: Opportunity) {
    const domain = opp.suggested_domains?.[0];
    if (!domain) return;
    setDeploying(opp.id);
    setDeployResult(null);
    try {
      const res = await fetch("/api/opportunities/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: opp.id, domain }),
      });
      const d = await res.json() as { success: boolean; message?: string; error?: string };
      setDeployResult(d.success ? d.message ?? "Déployé!" : d.error ?? "Erreur");
      if (d.success) await fetchCached();
    } catch { setDeployResult("Erreur réseau"); }
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
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-4">
          <div className="flex-1">
            <h2 className="font-medium text-white">Détection prédictive de niches</h2>
            <p className="text-xs text-gray-500 mt-1">
              Analyse tes données GSC + Perplexity pour trouver des niches rentables où tu n&apos;as pas encore de site dédié.
              Volume minimum: 10K recherches/mois. Projection trafic et revenus à 6 mois.
            </p>
          </div>
          <button
            onClick={runScan}
            disabled={loading}
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
            {loading ? "Scan Perplexity..." : "Scanner le marché"}
          </button>
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

        {/* Deploy result */}
        {deployResult && (
          <div className="bg-blue-900/30 border border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-300">
            {deployResult}
          </div>
        )}

        {/* Opportunities */}
        {opportunities.length > 0 && (
          <div className="space-y-4">
            {opportunities.map((opp, idx) => (
              <div key={opp.id ?? `opp-${idx}`} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{TYPE_ICON[opp.site_type] ?? "🌐"}</span>
                      <h3 className="text-lg font-bold text-white">{opp.niche}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${COMP_COLOR[opp.competition] ?? ""}`}>
                        {opp.competition}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">{opp.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-center bg-gray-800 rounded-lg px-4 py-2">
                      <div className="text-2xl font-bold text-cyan-400">{opp.confidence_score}</div>
                      <div className="text-[10px] text-gray-500">Confiance</div>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400"><Globe className="w-3 h-3" /> Volume/mois</div>
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
                {opp.competitors && opp.competitors.length > 0 && (
                  <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
                    <span className="text-gray-500">Concurrents:</span>
                    {opp.competitors.map((c, i) => (
                      <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
                        className="text-red-400 bg-red-900/20 hover:bg-red-900/40 rounded px-2 py-0.5 underline decoration-red-800 hover:decoration-red-400 transition-colors">
                        {c.name || c.url.replace(/^https?:\/\//, '').split('/')[0]}
                      </a>
                    ))}
                  </div>
                )}

                {/* Domains */}
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <span className="text-gray-500">Domaines suggérés:</span>
                  {(opp.suggested_domains || []).map((d, i) => (
                    <a key={i} href={`https://www.namecheap.com/domains/registration/results/?domain=${d}`} target="_blank" rel="noopener noreferrer"
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
                    {(opp.seed_articles || []).map((title, i) => (
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

                {/* Action buttons */}
                <div className="flex gap-3">
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
