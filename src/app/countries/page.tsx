"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Globe, AlertTriangle, FileText, ExternalLink, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface CountryStat {
  country: string;
  clicks: number;
  impressions: number;
  queries: number;
}

interface CannibalPage {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface CannibalGroup {
  query: string;
  pages: CannibalPage[];
}

interface ArticleRow {
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

interface CountriesData {
  success: boolean;
  countries: CountryStat[];
  cannibalization: CannibalGroup[];
  articles: ArticleRow[];
  filter: { country: string | null; language: string | null };
}

// ISO-3 → flag + display name
const COUNTRY_INFO: Record<string, { flag: string; name: string }> = {
  FRA: { flag: "🇫🇷", name: "France" },
  BEL: { flag: "🇧🇪", name: "Belgique" },
  CHE: { flag: "🇨🇭", name: "Suisse" },
  LUX: { flag: "🇱🇺", name: "Luxembourg" },
  MCO: { flag: "🇲🇨", name: "Monaco" },
  GBR: { flag: "🇬🇧", name: "United Kingdom" },
  USA: { flag: "🇺🇸", name: "United States" },
  IRL: { flag: "🇮🇪", name: "Ireland" },
  AUS: { flag: "🇦🇺", name: "Australia" },
  NZL: { flag: "🇳🇿", name: "New Zealand" },
  CAN: { flag: "🇨🇦", name: "Canada" },
  DEU: { flag: "🇩🇪", name: "Deutschland" },
  AUT: { flag: "🇦🇹", name: "Österreich" },
  ESP: { flag: "🇪🇸", name: "España" },
  MEX: { flag: "🇲🇽", name: "México" },
  ARG: { flag: "🇦🇷", name: "Argentina" },
  ITA: { flag: "🇮🇹", name: "Italia" },
  NLD: { flag: "🇳🇱", name: "Nederland" },
  PRT: { flag: "🇵🇹", name: "Portugal" },
  BRA: { flag: "🇧🇷", name: "Brasil" },
};

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

function countryDisplay(iso: string): { flag: string; name: string } {
  return COUNTRY_INFO[iso] ?? { flag: "🌍", name: iso };
}

export default function CountriesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [data, setData] = useState<CountriesData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchSites();
  }, []);

  useEffect(() => {
    if (selectedSite && selectedSite !== "all") void fetchCountries();
  }, [selectedSite, selectedCountry]);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[] | { sites?: Site[] };
      const list = Array.isArray(d) ? d : d.sites ?? [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite) setSelectedSite("all");
      }
    } catch {
      // ignore
    }
  }

  async function fetchCountries() {
    if (!selectedSite || selectedSite === "all") return;
    setLoading(true);
    try {
      const url = selectedCountry
        ? `/api/countries?site_id=${selectedSite}&country=${selectedCountry}`
        : `/api/countries?site_id=${selectedSite}`;
      const res = await fetch(url);
      const d = await res.json() as CountriesData;
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function truncatePath(url: string, max = 60) {
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      return path.length > max ? path.slice(0, max) + "…" : path;
    } catch {
      return url.length > max ? url.slice(0, max) + "…" : url;
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-semibold">Dashboard par Pays</h1>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-400 uppercase tracking-wide">Site</label>
            <select
              value={selectedSite ?? ""}
              onChange={(e) => {
                setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null);
                setSelectedCountry(null);
              }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-64"
            >
              <option value="all">🌐 Tous les sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-400 uppercase tracking-wide">Pays (filtre)</label>
            <select
              value={selectedCountry ?? ""}
              onChange={(e) => setSelectedCountry(e.target.value || null)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-64"
            >
              <option value="">— Tous les pays —</option>
              {data?.countries.map((c) => {
                const info = countryDisplay(c.country);
                return (
                  <option key={c.country} value={c.country}>
                    {info.flag} {info.name} ({c.clicks.toLocaleString()} clics)
                  </option>
                );
              })}
            </select>
          </div>

          <button
            onClick={() => void fetchCountries()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition-colors"
          >
            Actualiser
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Countries grid */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  Trafic par pays ({data.countries.length})
                </h2>
              </div>
              {data.countries.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  Aucune donnée country — lance une synchro GSC
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-5">
                  {data.countries.slice(0, 20).map((c) => {
                    const info = countryDisplay(c.country);
                    const isSelected = selectedCountry === c.country;
                    return (
                      <button
                        key={c.country}
                        onClick={() =>
                          setSelectedCountry(isSelected ? null : c.country)
                        }
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? "bg-cyan-900/30 border-cyan-700"
                            : "bg-gray-800/50 border-gray-700 hover:bg-gray-800"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{info.flag}</span>
                          <span className="text-sm font-medium text-white truncate">
                            {info.name}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {c.clicks.toLocaleString()} clics · {c.impressions.toLocaleString()} impr.
                        </div>
                        <div className="text-xs text-gray-500">
                          {c.queries} requêtes
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cannibalization */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  Cannibalisation ({data.cannibalization.length} conflits)
                  {selectedCountry && (
                    <span className="text-xs text-gray-400 ml-2">
                      · {countryDisplay(selectedCountry).flag} {countryDisplay(selectedCountry).name}
                    </span>
                  )}
                </h2>
              </div>
              {data.cannibalization.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  ✅ Pas de cannibalisation détectée
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {data.cannibalization.slice(0, 15).map((group) => (
                    <div key={group.query} className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-orange-300">
                          {group.query}
                        </span>
                        <span className="text-xs text-gray-500">
                          · {group.pages.length} pages en conflit
                        </span>
                      </div>
                      <div className="space-y-1">
                        {group.pages.map((p) => (
                          <div
                            key={p.url}
                            className="flex items-center justify-between text-xs text-gray-400 bg-gray-800/30 rounded px-3 py-1.5"
                          >
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 truncate mr-3"
                            >
                              {truncatePath(p.url)}
                            </a>
                            <div className="flex gap-3 flex-shrink-0">
                              <span>{p.clicks} clics</span>
                              <span>pos. {p.position.toFixed(1)}</span>
                              <span>{p.impressions} impr.</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Articles published */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-green-400" />
                  Articles publiés ({data.articles.length})
                  {data.filter.language && (
                    <span className="text-xs text-gray-400 ml-2">
                      · {LANG_FLAG[data.filter.language] ?? ""} {data.filter.language.toUpperCase()}
                    </span>
                  )}
                </h2>
              </div>
              {data.articles.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  Aucun article publié pour ce filtre
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-800">
                        <th className="px-5 py-3 text-left font-medium">Langue</th>
                        <th className="px-5 py-3 text-left font-medium">Mot-clé</th>
                        <th className="px-5 py-3 text-left font-medium">Date</th>
                        <th className="px-5 py-3 text-left font-medium">Statut</th>
                        <th className="px-5 py-3 text-left font-medium">GitHub</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.articles.map((a) => (
                        <tr
                          key={a.id}
                          className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                        >
                          <td className="px-5 py-3 text-base">
                            {LANG_FLAG[a.language] ?? a.language.toUpperCase()}
                          </td>
                          <td className="px-5 py-3">
                            <div className="text-white font-medium">{a.keyword}</div>
                            {a.article_title && a.article_title !== a.keyword && (
                              <div className="text-xs text-gray-400 truncate max-w-[300px]">
                                {a.article_title}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                            {formatDate(a.created_at)}
                          </td>
                          <td className="px-5 py-3">
                            {a.status === "published" ? (
                              <span className="flex items-center gap-1 text-green-400">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Publié
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-red-400">
                                <XCircle className="w-3.5 h-3.5" />
                                {a.status}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {a.github_url ? (
                              <a
                                href={a.github_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                              >
                                Voir <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
