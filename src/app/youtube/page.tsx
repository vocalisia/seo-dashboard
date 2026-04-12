"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  PlaySquare, Search, Loader2, TrendingUp, Users, Eye,
  BarChart3, DollarSign, ArrowLeft, ChevronDown, ChevronUp,
  ExternalLink
} from "lucide-react";
import { NicheScanResult } from "@/lib/youtube";
import Link from "next/link";

const DEFAULT_NICHES = [
  "automatisation ia revenus",
  "intelligence artificielle business",
  "finance personnelle francais",
  "immobilier investissement",
  "dropshipping 2025",
];

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function OpportunityBadge({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-green-500/20 text-green-400 border-green-500/30" :
    score >= 58 ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
    score >= 42 ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
    "bg-red-500/20 text-red-400 border-red-500/30";
  return (
    <span className={`text-xl font-bold px-3 py-1 rounded-lg border ${color}`}>
      {score}/100
    </span>
  );
}

function NicheCard({ result }: { result: NicheScanResult }) {
  const [expanded, setExpanded] = useState(false);

  if (result.error) {
    return (
      <div className="bg-gray-900 border border-red-500/30 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <span className="text-red-400 font-semibold">"{result.keyword}"</span>
          <span className="text-red-400 text-sm">— {result.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-1">"{result.keyword}"</h3>
            <p className="text-sm text-gray-400">{result.recommendation}</p>
          </div>
          <OpportunityBadge score={result.opportunityScore} />
        </div>
      </div>

      {/* Scores */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-gray-800">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Demande
            </span>
            <span className="font-semibold text-white">{result.demandScore}/100</span>
          </div>
          <ScoreBar value={result.demandScore} color="bg-blue-500" />
          <p className="text-xs text-gray-500 mt-1">{formatNumber(result.avgRecentViews)} vues moy. (90j)</p>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400 flex items-center gap-1">
              <Users className="w-3 h-3" /> Concurrence
            </span>
            <span className="font-semibold text-white">{result.competitionScore}/100</span>
          </div>
          <ScoreBar value={result.competitionScore} color="bg-red-500" />
          <p className="text-xs text-gray-500 mt-1">{formatNumber(result.avgSubscribers)} subs moy.</p>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400 flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> CPM estimé
            </span>
            <span className="font-semibold text-green-400">
              ${result.estimatedCPM.min}–${result.estimatedCPM.max}
            </span>
          </div>
          <div className="flex gap-2 text-xs text-gray-500 mt-2">
            <span>{result.channelCount} chaînes trouvées</span>
          </div>
        </div>
      </div>

      {/* Expand button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between text-sm text-gray-400 hover:text-white hover:bg-gray-800/50 transition"
      >
        <span>Voir les chaînes et vidéos ({result.topChannels.length} chaînes, {result.recentTopVideos.length} vidéos)</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-5 pt-0 space-y-5">
          {/* Top Channels */}
          {result.topChannels.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" /> Top Chaînes
              </h4>
              <div className="space-y-2">
                {result.topChannels.map((ch) => (
                  <div key={ch.id} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                    {ch.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ch.thumbnail} alt={ch.name} className="w-8 h-8 rounded-full" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{ch.name}</p>
                      <p className="text-xs text-gray-400">
                        {formatNumber(ch.subscribers)} abonnés · {formatNumber(ch.totalViews)} vues · {ch.videoCount} vidéos
                      </p>
                    </div>
                    <a
                      href={ch.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-blue-400 flex-shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Top Videos */}
          {result.recentTopVideos.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" /> Vidéos les plus vues (90 derniers jours)
              </h4>
              <div className="space-y-2">
                {result.recentTopVideos.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                    {v.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumbnail} alt={v.title} className="w-16 h-10 rounded object-cover flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white line-clamp-1">{v.title}</p>
                      <p className="text-xs text-gray-400">
                        {v.channelName} · {formatNumber(v.views)} vues · {formatNumber(v.likes)} likes
                      </p>
                    </div>
                    <a
                      href={`https://www.youtube.com/watch?v=${v.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-red-400 flex-shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function YouTubeScannerPage() {
  const { data: session } = useSession();
  const [keywords, setKeywords] = useState(DEFAULT_NICHES.join("\n"));
  const [results, setResults] = useState<NicheScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaUsed, setQuotaUsed] = useState(0);

  async function handleScan() {
    setLoading(true);
    setError(null);
    setResults([]);

    const kwList = keywords
      .split("\n")
      .map(k => k.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (kwList.length === 0) {
      setError("Entre au moins un mot-clé");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/youtube/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: kwList }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResults(data.results ?? []);
        // Each keyword uses ~202 quota units (2x search.list = 200 + stats = 2)
        setQuotaUsed(prev => prev + kwList.length * 202);
      }
    } catch {
      setError("Erreur de connexion au serveur");
    }

    setLoading(false);
  }

  const sortedResults = [...results].sort((a, b) => b.opportunityScore - a.opportunityScore);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PlaySquare className="w-8 h-8 text-red-500" />
            <div>
              <h1 className="text-xl font-bold">YouTube Niche Scanner</h1>
              <p className="text-xs text-gray-400">Analyse la demande, la concurrence et le CPM de chaque niche</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {quotaUsed > 0 && (
              <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full">
                Quota utilisé : ~{quotaUsed.toLocaleString()} / 10 000 unités/j
              </span>
            )}
            {session?.user?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="avatar" className="w-7 h-7 rounded-full" />
            )}
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition"
            >
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Search Panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">Niches à analyser</h2>
            <span className="text-xs text-gray-500">(1 par ligne, max 10)</span>
          </div>
          <textarea
            value={keywords}
            onChange={e => setKeywords(e.target.value)}
            rows={6}
            placeholder={"automatisation ia revenus\nfinance personnelle francais\nimmobilier investissement\n..."}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-gray-500">
              Chaque scan consomme ~202 unités de quota YouTube API · Quota journalier : 10 000 unités
            </p>
            <button
              onClick={handleScan}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scan en cours...</>
                : <><Search className="w-4 h-4" /> Scanner YouTube</>
              }
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            {error.includes("YOUTUBE_API_KEY") ? (
              <div>
                <p className="font-semibold mb-1">Clé API YouTube non configurée</p>
                <p>Ajoute <code className="bg-red-500/20 px-1 rounded">YOUTUBE_API_KEY</code> dans tes variables d&apos;environnement Vercel.</p>
                <p className="mt-1 text-xs text-red-300">Google Cloud Console → APIs → YouTube Data API v3 → Créer une clé API</p>
              </div>
            ) : error}
          </div>
        )}

        {/* Results */}
        {sortedResults.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-400" />
                Résultats ({sortedResults.length} niches) — triés par score d&apos;opportunité
              </h2>
              <div className="flex gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> ≥75 Excellent</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> ≥58 Bon</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> ≥42 Modéré</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &lt;42 Saturé</span>
              </div>
            </div>
            {sortedResults.map(result => (
              <NicheCard key={result.keyword} result={result} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
