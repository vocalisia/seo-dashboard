"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Loader2, CheckCircle, XCircle, Zap, Globe } from "lucide-react";
import Link from "next/link";

interface Article {
  id: number;
  site_id: number;
  site_name: string | null;
  keyword: string;
  article_title: string;
  github_url: string | null;
  image_url: string | null;
  language: string;
  status: string;
  created_at: string;
}

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

const STATUS_COLOR: Record<string, string> = {
  published: "border-green-600 bg-green-900/20",
  dry_run: "border-yellow-600 bg-yellow-900/20",
  failed: "border-red-600 bg-red-900/20",
};

export default function CalendarPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const res = await fetch("/api/autopilot/history");
      const d = await res.json() as { runs?: Article[] };
      setArticles(d.runs ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  // Group articles by date (YYYY-MM-DD)
  const byDate: Record<string, Article[]> = {};
  for (const a of articles) {
    const day = a.created_at.slice(0, 10);
    (byDate[day] ??= []).push(a);
  }

  // Generate calendar grid for current month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun

  const monthName = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const calendarDays: (number | null)[] = [];
  // Pad start
  for (let i = 0; i < (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1); i++) {
    calendarDays.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push(d);
  }

  const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  // Stats
  const published = articles.filter((a) => a.status === "published").length;
  const thisMonth = articles.filter((a) => {
    const d = new Date(a.created_at);
    return d.getMonth() === month && d.getFullYear() === year && a.status === "published";
  }).length;
  const languages = new Set(articles.filter((a) => a.status === "published").map((a) => a.language));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <CalendarDays className="w-5 h-5 text-indigo-400" />
        <h1 className="text-xl font-semibold">Calendrier Éditorial</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Articles publiés (total)</div>
            <div className="text-3xl font-bold text-green-400 mt-1">{published}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Ce mois-ci</div>
            <div className="text-3xl font-bold text-indigo-400 mt-1">{thisMonth}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Langues actives</div>
            <div className="text-2xl font-bold text-white mt-1 flex gap-1">
              {[...languages].map((l) => (
                <span key={l} title={l}>{LANG_FLAG[l] ?? l}</span>
              ))}
              {languages.size === 0 && "—"}
            </div>
          </div>
        </div>

        {/* Calendar grid */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold text-lg text-white mb-4 capitalize">{monthName}</h2>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {/* Week day headers */}
              {weekDays.map((d) => (
                <div key={d} className="text-center text-xs text-gray-500 py-2 font-medium">
                  {d}
                </div>
              ))}

              {/* Calendar cells */}
              {calendarDays.map((day, i) => {
                if (day === null) {
                  return <div key={`empty-${i}`} className="min-h-[80px]" />;
                }

                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dayArticles = byDate[dateStr] ?? [];
                const isToday = day === now.getDate();
                const isFuture = day > now.getDate();

                return (
                  <div
                    key={day}
                    className={`min-h-[80px] rounded-lg border p-1.5 ${
                      isToday
                        ? "border-indigo-500 bg-indigo-900/20"
                        : isFuture
                          ? "border-gray-800 bg-gray-900/30"
                          : "border-gray-800 bg-gray-900/50"
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 ${isToday ? "text-indigo-400" : "text-gray-500"}`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayArticles.slice(0, 4).map((a) => (
                        <div
                          key={a.id}
                          className={`text-[10px] px-1 py-0.5 rounded border-l-2 truncate ${STATUS_COLOR[a.status] ?? "border-gray-700 bg-gray-800/50"}`}
                          title={`${a.keyword} (${a.language}) — ${a.status}`}
                        >
                          {LANG_FLAG[a.language] ?? ""} {a.keyword.slice(0, 20)}
                        </div>
                      ))}
                      {dayArticles.length > 4 && (
                        <div className="text-[10px] text-gray-500 px-1">
                          +{dayArticles.length - 4} autres
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming Monday prediction */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="font-medium text-gray-200 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Prochain lundi — articles prévus
          </h2>
          <p className="text-sm text-gray-400">
            Le cron du lundi 9h va générer automatiquement des articles pour chaque site selon les langues configurées.
            Passage 1 = mots-clés GSC, Passage 2 = mots-clés concurrents (vol ≥ 1000/mois).
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <Globe className="w-3.5 h-3.5" />
            <span>Configure les langues par site dans</span>
            <Link href="/autopilot" className="text-orange-400 hover:text-orange-300">/autopilot</Link>
          </div>
        </div>

        {/* Recent articles list */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="font-medium text-gray-200">Derniers articles</h2>
          </div>
          <div className="divide-y divide-gray-800">
            {articles.slice(0, 20).map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                <span className="text-base">{LANG_FLAG[a.language] ?? a.language}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{a.keyword}</div>
                  <div className="text-xs text-gray-500">{a.site_name} · {new Date(a.created_at).toLocaleDateString("fr-FR")}</div>
                </div>
                {a.status === "published" ? (
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                ) : a.status === "dry_run" ? (
                  <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                )}
                {a.github_url && (
                  <a href={a.github_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                    GitHub
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
