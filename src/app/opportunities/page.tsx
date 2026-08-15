"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp, AlertTriangle, FileText, X, Activity } from "lucide-react";
import Link from "next/link";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site { id: number; name: string; url: string; }
interface CtrRow {
  query: string; site_id?: number; site_name?: string | null;
  position: number; clicks: number; impressions: number;
  actualCtr: number; expectedCtr: number; ctrGap: number; potentialClicks: number;
}
interface CannibRow {
  query: string; site_id?: number; site_name?: string | null;
  pageCount: number; pages: string[]; avgPosition: number; clicks: number;
}

type Tab = "ctr" | "cannib" | "briefs";
type SiteScope = number | "all";
type RequestTiming = { label: string; ms: number; server: string | null; scope: SiteScope };
const REQUEST_TIMEOUT_MS = 30_000;
const BRIEF_TIMEOUT_MS = 65_000;

function requestError(error: unknown, action: string): string {
  if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
    return `${action} a dépassé le délai autorisé. Réessayez; si cela recommence, vérifiez la disponibilité de l’API.`;
  }
  if (error instanceof TypeError) return `${action} est impossible : ${error.message}. Vérifiez la connexion puis réessayez.`;
  return error instanceof Error
    ? `${error.message}. Rechargez la page si votre session a expiré, puis réessayez.`
    : `${action} a échoué pour une raison inconnue. Réessayez.`;
}

function isSite(value: unknown): value is Site {
  return isRecord(value) && Number.isInteger(value.id)
    && typeof value.name === "string" && typeof value.url === "string";
}

function hasFiniteNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isCtrRow(value: unknown): value is CtrRow {
  return isRecord(value) && typeof value.query === "string" && hasFiniteNumbers(value,
    ["position", "clicks", "impressions", "actualCtr", "expectedCtr", "ctrGap", "potentialClicks"]);
}

function isCannibRow(value: unknown): value is CannibRow {
  return isRecord(value) && typeof value.query === "string" && Array.isArray(value.pages)
    && value.pages.every((page) => typeof page === "string")
    && hasFiniteNumbers(value, ["pageCount", "avgPosition", "clicks"]);
}

const isSiteList = (value: unknown): value is Site[] => Array.isArray(value) && value.every(isSite);
const isCtrRows = (value: unknown): value is CtrRow[] => Array.isArray(value) && value.every(isCtrRow);
const isCannibRows = (value: unknown): value is CannibRow[] => Array.isArray(value) && value.every(isCannibRow);

interface ContentBriefResponse { success: true; brief: string; }
function isContentBriefResponse(value: unknown): value is ContentBriefResponse {
  return isRecord(value) && value.success === true && typeof value.brief === "string" && Boolean(value.brief.trim());
}

type BriefRequest = { query: string; position: number; impressions: number; site_url: string };
async function requestContentBrief(body: BriefRequest): Promise<string> {
  const response = await fetch("/api/content-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS),
  });
  const payload = await readApiJson(response, isContentBriefResponse, "La génération du brief a échoué");
  return payload.brief;
}

type TimedResponse = { response: Response; timing: { label: string; ms: number; server: string | null } };
async function timedFetch(label: string, url: string): Promise<TimedResponse> {
  const started = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { response, timing: {
    label, ms: performance.now() - started, server: response.headers.get("X-Response-Time"),
  } };
}

function ctrGapColor(gap: number): string {
  if (gap > 0.1) return "text-red-400";
  if (gap > 0.05) return "text-yellow-400";
  return "text-green-400";
}

function pct(v: number) { return (v * 100).toFixed(1) + "%"; }

function formatMs(ms: number | null) {
  if (!ms || !Number.isFinite(ms)) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

type BriefModalProps = Omit<BriefRequest, "site_url"> & { siteUrl: string; onClose: () => void };
function BriefModal({ query, position, impressions, siteUrl, onClose }: BriefModalProps) {
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void generateBrief(); }, []);

  async function generateBrief() {
    setLoading(true);
    setErr(null);
    try {
      const nextBrief = await requestContentBrief({ query, position, impressions, site_url: siteUrl });
      setBrief(nextBrief);
    } catch (error) {
      setErr(requestError(error, "La génération du brief"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="font-semibold">Brief IA — {query}</h2>
            <p className="text-xs text-gray-500">Position {position} · {impressions.toLocaleString()} impressions</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <div className="flex items-center gap-3 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /> Génération en cours...</div>}
          {err && (
            <div className="flex flex-wrap items-center gap-3 text-red-400">
              <span>{err}</span>
              <button type="button" onClick={() => void generateBrief()} disabled={loading}
                className="rounded border border-red-800 px-3 py-1 text-xs hover:bg-red-900/30 disabled:opacity-50">Réessayer</button>
            </div>
          )}
          {brief && <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">{brief}</pre>}
        </div>
      </div>
    </div>
  );
}

function BriefsTab({ selectedSite }: { selectedSite: Site | null }) {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    if (!keyword.trim()) return;
    const hadConfirmedBrief = Boolean(brief);
    setLoading(true);
    setErr(null);
    try {
      const nextBrief = await requestContentBrief({
        query: keyword.trim(), position: 0, impressions: 0, site_url: selectedSite?.url ?? "",
      });
      setBrief(nextBrief);
    } catch (error) {
      const message = requestError(error, "La génération du brief");
      setErr(hadConfirmedBrief ? `${message} Le dernier brief confirmé reste affiché.` : message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="font-medium mb-4">Générer un brief SEO</h3>
        <div className="flex gap-3">
          <input type="text" placeholder="Entrez un mot clé..." value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()}
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          <button onClick={generate} disabled={loading || !keyword.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Générer
          </button>
        </div>
        {err && <div className="mt-3 text-red-400 text-sm">{err}</div>}
      </div>
      {brief && <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">{brief}</pre>
      </div>}
    </div>
  );
}

export default function OpportunitiesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<Site | "all" | null>(null);
  const [tab, setTab] = useState<Tab>("ctr");
  const [ctrRows, setCtrRows] = useState<CtrRow[]>([]);
  const [ctrScope, setCtrScope] = useState<SiteScope | null>(null);
  const [ctrError, setCtrError] = useState<string | null>(null);
  const [cannibRows, setCannibRows] = useState<CannibRow[]>([]);
  const [cannibScope, setCannibScope] = useState<SiteScope | null>(null);
  const [cannibError, setCannibError] = useState<string | null>(null);
  const [loadingCtr, setLoadingCtr] = useState(false);
  const [loadingCannib, setLoadingCannib] = useState(false);
  const [lastTiming, setLastTiming] = useState<RequestTiming | null>(null);
  const [modal, setModal] = useState<CtrRow | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSites() {
      try {
        const response = await fetch("/api/sites", { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const payload = await readApiJson(response, isSiteList, "Le chargement des sites a échoué");
        if (!active) return;
        setSites(payload);
        setSitesError(payload.length === 0 ? "Aucun site actif n’a été renvoyé. Vérifiez la configuration des sites." : null);
        if (payload.length > 0) setSelectedSite((current) => current ?? payload[0]);
      } catch (error) {
        if (active) setSitesError(requestError(error, "Le chargement des sites"));
      }
    }

    void loadSites();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedSite || tab === "briefs") return;
    let active = true;
    const scope: SiteScope = selectedSite === "all" ? "all" : selectedSite.id;

    async function loadRows() {
      if (tab === "ctr") { setLoadingCtr(true); setCtrError(null); }
      else { setLoadingCannib(true); setCannibError(null); }

      try {
        if (tab === "ctr") {
          const { response, timing } = await timedFetch("CTR opportunities", `/api/ctr-opportunities?site_id=${scope}&days=30`);
          const payload = await readApiJson(response, isCtrRows, "Le chargement des opportunités CTR a échoué");
          if (!active) return;
          setCtrRows(payload);
          setCtrScope(scope);
          setLastTiming({ ...timing, scope });
        } else {
          const { response, timing } = await timedFetch("Cannibalisation", `/api/cannibalization?site_id=${scope}`);
          const payload = await readApiJson(response, isCannibRows, "Le chargement des cannibalisations a échoué");
          if (!active) return;
          setCannibRows(payload);
          setCannibScope(scope);
          setLastTiming({ ...timing, scope });
        }
      } catch (error) {
        if (!active) return;
        const suffix = " Les dernières données confirmées restent conservées lorsqu’elles existent.";
        const action = tab === "ctr" ? "Le chargement des opportunités CTR" : "Le chargement des cannibalisations";
        (tab === "ctr" ? setCtrError : setCannibError)(`${requestError(error, action)}${suffix}`);
      } finally {
        if (active) (tab === "ctr" ? setLoadingCtr : setLoadingCannib)(false);
      }
    }

    void loadRows();
    return () => { active = false; };
  }, [selectedSite, tab]);

  function handleSiteChange(id: number) { setSelectedSite(sites.find((site) => site.id === id) ?? null); }

  const selectedScope: SiteScope | null = selectedSite === "all" ? "all" : selectedSite?.id ?? null;
  const hasCtrData = selectedScope !== null && ctrScope === selectedScope;
  const hasCannibData = selectedScope !== null && cannibScope === selectedScope;
  const displayedCtrRows = hasCtrData ? ctrRows : [];
  const displayedCannibRows = hasCannibData ? cannibRows : [];
  const visibleTiming = lastTiming?.scope === selectedScope ? lastTiming : null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "ctr", label: "CTR Optimizer", icon: <TrendingUp className="w-4 h-4" /> },
    { key: "cannib", label: "Cannibalisation", icon: <AlertTriangle className="w-4 h-4" /> },
    { key: "briefs", label: "Briefs IA", icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <TrendingUp className="w-6 h-6 text-green-400" />
        <h1 className="text-xl font-bold">Opportunités SEO</h1>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          {visibleTiming ? `${visibleTiming.label} — dernière réussite: ${formatMs(visibleTiming.ms)}${visibleTiming.server ? ` serveur ${visibleTiming.server}` : ""}` : "vitesse en attente"}
        </div>
      </header>

      <div className="px-6 py-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <select
            aria-label="Site à analyser"
            value={selectedSite === "all" ? "all" : typeof selectedSite === "object" && selectedSite ? String(selectedSite.id) : ""}
            onChange={(e) => {
              if (e.target.value === "all") setSelectedSite("all");
              else handleSiteChange(parseInt(e.target.value, 10));
            }}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.url}</option>
            ))}
          </select>
          {sitesError && (
            <div className="mt-3 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300" role="alert">
              {sitesError}
            </div>
          )}
        </div>

        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 mb-6 w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === t.key ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "ctr" && (
          <div>
            {ctrError && (
              <div className="mb-4 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300" role="alert">
                {ctrError}
              </div>
            )}
            {loadingCtr && hasCtrData && (
              <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Actualisation des données confirmées...
              </div>
            )}
            {loadingCtr && !hasCtrData ? (
              <div className="flex items-center gap-3 text-gray-400 py-8">
                <Loader2 className="w-5 h-5 animate-spin" /> Chargement...
              </div>
            ) : hasCtrData ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800">
                  <h2 className="font-semibold">Mots clés sous-performants — CTR Optimizer</h2>
                  <p className="text-xs text-gray-500 mt-1">Triés par clics potentiels perdus</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                        <th className="py-3 px-4 text-left">
                          <span className="inline-flex items-center gap-2">
                            Mot clé
                            <CopyKeywordsButton keywords={displayedCtrRows.map((row) => row.query)} />
                          </span>
                        </th>
                        {selectedSite === "all" && <th className="py-3 px-4 text-left">Site</th>}
                        <th className="py-3 px-4 text-center">Position</th>
                        <th className="py-3 px-4 text-center">CTR actuel</th>
                        <th className="py-3 px-4 text-center">CTR attendu</th>
                        <th className="py-3 px-4 text-right">Impressions</th>
                        <th className="py-3 px-4 text-right">Clics perdus</th>
                        <th className="py-3 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedCtrRows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition">
                          <td className="py-3 px-4 text-gray-200 max-w-xs truncate font-medium">{row.query}</td>
                          {selectedSite === "all" && <td className="py-3 px-4 text-xs text-blue-300">{row.site_name ?? "—"}</td>}
                          <td className="py-3 px-4 text-center text-gray-400">{row.position}</td>
                          <td className="py-3 px-4 text-center text-gray-400">{pct(row.actualCtr)}</td>
                          <td className="py-3 px-4 text-center text-gray-400">{pct(row.expectedCtr)}</td>
                          <td className="py-3 px-4 text-right text-gray-400">{row.impressions.toLocaleString()}</td>
                          <td className={`py-3 px-4 text-right font-medium ${ctrGapColor(row.ctrGap)}`}>
                            -{row.potentialClicks.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => setModal(row)}
                              className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-1 rounded text-xs transition"
                            >
                              Brief IA
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {displayedCtrRows.length === 0 && (
                    <div className="py-12 text-center text-gray-500">Aucune opportunité trouvée</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {tab === "cannib" && (
          <div>
            {cannibError && (
              <div className="mb-4 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300" role="alert">
                {cannibError}
              </div>
            )}
            {loadingCannib && hasCannibData && (
              <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Actualisation des données confirmées...
              </div>
            )}
            {loadingCannib && !hasCannibData ? (
              <div className="flex items-center gap-3 text-gray-400 py-8">
                <Loader2 className="w-5 h-5 animate-spin" /> Chargement...
              </div>
            ) : hasCannibData ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800">
                  <h2 className="font-semibold">Cannibalisation de mots clés</h2>
                  <p className="text-xs text-gray-500 mt-1">Requêtes où plusieurs pages se font concurrence</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                        <th className="py-3 px-4 text-left">
                          <span className="inline-flex items-center gap-2">
                            Mot clé
                            <CopyKeywordsButton keywords={displayedCannibRows.map((row) => row.query)} />
                          </span>
                        </th>
                        {selectedSite === "all" && <th className="py-3 px-4 text-left">Site</th>}
                        <th className="py-3 px-4 text-center">Nb pages</th>
                        <th className="py-3 px-4 text-left">URLs en compétition</th>
                        <th className="py-3 px-4 text-right">Clics</th>
                        <th className="py-3 px-4 text-right">Position moy.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedCannibRows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition">
                          <td className="py-3 px-4 text-gray-200 font-medium max-w-xs truncate">{row.query}</td>
                          {selectedSite === "all" && <td className="py-3 px-4 text-xs text-blue-300">{row.site_name ?? "—"}</td>}
                          <td className="py-3 px-4 text-center">
                            <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs">
                              {row.pageCount}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {row.pages.slice(0, 3).map((p, j) => (
                                <span key={j} className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs max-w-[200px] truncate" title={p}>
                                  {p.replace(/^https?:\/\/[^/]+/, "")}
                                </span>
                              ))}
                              {row.pages.length > 3 && (
                                <span className="text-gray-500 text-xs">+{row.pages.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-gray-400">{row.clicks.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right text-gray-400">{Number(row.avgPosition).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {displayedCannibRows.length === 0 && (
                    <div className="py-12 text-center text-gray-500">Aucune cannibalisation détectée</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {tab === "briefs" && <BriefsTab selectedSite={typeof selectedSite === "object" ? selectedSite : null} />}
      </div>

      {modal && selectedSite && selectedSite !== "all" && (
        <BriefModal
          query={modal.query}
          position={modal.position}
          impressions={modal.impressions}
          siteUrl={selectedSite.url}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
