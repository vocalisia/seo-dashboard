"use client";

import { useEffect, useState } from "react";
import { ExternalLink, GitBranch, Link2, Loader2, Network, Search } from "lucide-react";
import { ToolAlert, ToolEmptyState, ToolLoadingState, ToolPage, ToolPanel } from "@/components/dashboard/ToolPage";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface PageRankResult {
  rank: number;
  url: string;
  score: number;
  inLinks: number;
  outLinks: number;
  clicks: number;
}

interface PRResponse {
  top20: PageRankResult[];
  orphans: string[];
  suggestions: string[];
  total: number;
  discovered?: number;
  crawled?: number;
  failed?: number;
  partial?: boolean;
  duration_ms?: number;
  contextual_links?: number;
  sitewide_links_excluded?: number;
  graph_mode?: "contextual" | "all_internal";
  error?: string;
}

type ResultTab = "top" | "orphans" | "suggestions";

export default function PageRankPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PRResponse | null>(null);
  const [tab, setTab] = useState<ResultTab>("top");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/sites", { signal: controller.signal });
        const data = await response.json() as Site[] | { sites?: Site[]; error?: string };
        if (!response.ok) throw new Error(!Array.isArray(data) && data.error ? data.error : `Sites indisponibles (HTTP ${response.status})`);
        const list = Array.isArray(data) ? data : (data.sites ?? []);
        setSites(list);
        if (list.length > 0) setSelectedSite(list[0].id);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Impossible de charger les sites.");
      } finally {
        if (!controller.signal.aborted) setSitesLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function calculate() {
    if (!selectedSite) return;
    const site = sites.find((candidate) => candidate.id === selectedSite);
    if (!site) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setTab("top");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 58_000);
    try {
      const response = await fetch("/api/pagerank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, site_url: site.url, max_pages: 600 }),
        signal: controller.signal,
      });
      const data = await response.json() as PRResponse;
      if (!response.ok || data.error) throw new Error(data.error ?? `Calcul impossible (HTTP ${response.status})`);
      setResult(data);
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "AbortError" ? "Le crawl a atteint sa limite de temps avant de produire un graphe exploitable. Réessaie sur un sitemap plus petit." : reason instanceof Error ? reason.message : "Le calcul a échoué.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  const coverage = result ? Math.round(((result.crawled ?? result.total) / Math.max(1, result.discovered ?? result.total)) * 100) : 0;

  return (
    <ToolPage
      title="PageRank interne"
      eyebrow="Maillage contextuel"
      description="Crawle le sitemap, retire les liens de navigation répétés de l’analyse et calcule l’autorité interne à partir des liens contextuels observés. Les clics proviennent de GSC."
      icon={GitBranch}
      width="wide"
      actions={(
        <button type="button" onClick={() => void calculate()} disabled={!selectedSite || loading || sitesLoading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <GitBranch className="h-4 w-4" aria-hidden="true" />}
          {loading ? "Crawl en cours" : "Calculer le PageRank"}
        </button>
      )}
    >
      <ToolPanel className="p-4">
        <label htmlFor="pagerank-site" className="mb-2 block text-sm font-medium text-white">Site à analyser</label>
        <select id="pagerank-site" aria-label="Site à analyser" value={selectedSite ?? ""} onChange={(event) => { setSelectedSite(event.target.value ? Number(event.target.value) : null); setResult(null); setError(null); }} disabled={sitesLoading} className="h-12 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-white outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">Sélectionner un site</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
        <p className="mt-2 text-xs leading-5 text-slate-500">Le calcul s’arrête avant la limite d’exécution. Une couverture partielle est signalée et n’est jamais présentée comme un crawl complet.</p>
      </ToolPanel>

      {error && <ToolAlert tone="error">{error}</ToolAlert>}
      {loading && <ToolLoadingState title="Construction du graphe interne" description="Lecture du sitemap, crawl des pages, détection des liens répétés puis calcul du PageRank." rows={5} />}

      {!loading && !result && !error && (
        <ToolPanel>
          <ToolEmptyState icon={Network} title="Aucun graphe calculé" description="Sélectionne un site puis lance le crawl. Le résultat distinguera les pages découvertes, réellement crawlées et exclues par la limite de temps." action={<button type="button" onClick={() => void calculate()} disabled={!selectedSite} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">Analyser ce site</button>} />
        </ToolPanel>
      )}

      {result && !loading && (
        <>
          <section aria-label="Résumé du crawl" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Pages découvertes", result.discovered ?? result.total],
              ["Pages crawlées", result.crawled ?? result.total],
              ["Couverture", `${coverage} %`],
              ["Liens contextuels", result.contextual_links ?? 0],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums text-white">{typeof value === "number" ? value.toLocaleString("fr-FR") : value}</div></div>)}
          </section>

          <ToolAlert tone={result.partial ? "warning" : "success"}>
            {result.partial
              ? `Crawl partiel : ${result.crawled ?? result.total}/${result.discovered ?? result.total} pages découvertes ont été analysées. Les pages sans lien entrant ne sont pas conclues tant que la couverture n’est pas complète.`
              : `Crawl complet. ${result.sitewide_links_excluded ?? 0} occurrence(s) de liens de navigation répétés ont été retirées du graphe contextuel.`}
          </ToolAlert>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Résultats PageRank">
            {(["top", "orphans", "suggestions"] as ResultTab[]).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${tab === value ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}>{value === "top" ? "Pages les plus fortes" : value === "orphans" ? `Sans lien contextuel (${result.partial ? "—" : result.orphans.length})` : `Suggestions (${result.suggestions.length})`}</button>)}
          </div>

          {tab === "top" && (
            <ToolPanel className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-sm">
                  <thead className="bg-slate-950/70 text-left text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">URL</th><th className="px-3 py-3 text-right font-medium">Score PR</th><th className="px-3 py-3 text-right font-medium">Entrants contextuels</th><th className="px-3 py-3 text-right font-medium">Sortants contextuels</th><th className="px-4 py-3 text-right font-medium">Clics GSC</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {result.top20.map((row) => <tr key={row.url} className="hover:bg-slate-800/30"><td className="px-4 py-3 tabular-nums text-slate-500">{row.rank}</td><td className="max-w-xl px-4 py-3"><a href={row.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-blue-200 hover:text-blue-100"><span className="truncate">{row.url}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a>{row.score > 0.01 && row.clicks === 0 && <div className="mt-1 text-[11px] text-amber-300">Autorité interne sans clic GSC observé</div>}</td><td className="px-3 py-3 text-right font-mono tabular-nums text-cyan-200">{row.score.toFixed(4)}</td><td className="px-3 py-3 text-right tabular-nums text-slate-200">{row.inLinks}</td><td className="px-3 py-3 text-right tabular-nums text-slate-200">{row.outLinks}</td><td className="px-4 py-3 text-right tabular-nums text-slate-200">{row.clicks}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </ToolPanel>
          )}

          {tab === "orphans" && (
            <ToolPanel className="p-5">
              {result.partial ? <ToolEmptyState icon={Search} title="Diagnostic suspendu" description="Le crawl est partiel : les pages non crawlées pourraient contenir des liens entrants. Aucun faux orphelin n’est affiché." /> : result.orphans.length === 0 ? <ToolEmptyState icon={Link2} title="Aucune page sans lien contextuel" description="Toutes les pages crawlées reçoivent au moins un lien contextuel, après retrait de la navigation répétée." /> : <ul className="space-y-2">{result.orphans.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 font-mono text-xs text-amber-200 hover:border-slate-700"><span className="truncate">{url}</span><ExternalLink className="ml-auto h-3 w-3 shrink-0" /></a></li>)}</ul>}
            </ToolPanel>
          )}

          {tab === "suggestions" && (
            <ToolPanel className="p-5">
              {result.suggestions.length === 0 ? <ToolEmptyState icon={Link2} title="Aucune suggestion calculable" description="Le graphe observé ne permet pas encore de proposer un lien cohérent. Vérifie la couverture du crawl et la structure des URLs." /> : <ol className="space-y-2">{result.suggestions.map((suggestion, index) => <li key={`${index}-${suggestion}`} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm leading-6 text-slate-200"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-500/10 text-xs font-semibold text-blue-200">{index + 1}</span><span>{suggestion}</span></li>)}</ol>}
            </ToolPanel>
          )}
        </>
      )}
    </ToolPage>
  );
}
