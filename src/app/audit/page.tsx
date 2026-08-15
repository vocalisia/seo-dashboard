"use client";

import { useEffect, useState } from "react";
import { Gauge, Loader2, Monitor, Smartphone, Zap } from "lucide-react";
import { ToolAlert, ToolEmptyState, ToolLoadingState, ToolPage, ToolPanel } from "@/components/dashboard/ToolPage";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface PageSpeedMetrics {
  score: number;
  lcp: number;
  cls: number;
  fcp: number;
  ttfb: number;
  inp: number;
}

interface LighthouseAuditResult {
  mobile: PageSpeedMetrics;
  desktop: PageSpeedMetrics;
  url: string;
  measurement_status: "live" | "cache";
  checked_at?: string;
  measurement_notice?: string;
}

interface OriginProbeMetrics {
  status_code: number;
  ok: boolean;
  ttfb: number;
  total: number;
  transfer_kb: number;
  transfer_capped: boolean;
  content_type: string | null;
  compression: string | null;
  cache_control: string | null;
  final_url: string;
}

interface OriginProbeAuditResult {
  url: string;
  measurement_status: "origin_probe";
  checked_at: string;
  measurement_notice: string;
  origin_probe: { mobile: OriginProbeMetrics; desktop: OriginProbeMetrics };
}

type AuditResult = LighthouseAuditResult | OriginProbeAuditResult;

type MetricStatus = "good" | "needs-improvement" | "poor";

function scoreTone(score: number) {
  if (score >= 90) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (score >= 50) return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return "border-red-500/40 bg-red-500/10 text-red-100";
}

function metricStatus(metric: string, value: number): MetricStatus {
  const thresholds: Record<string, [number, number]> = {
    lcp: [2.5, 4],
    cls: [0.1, 0.25],
    fcp: [1.8, 3],
    ttfb: [0.8, 1.8],
  };
  const [good, poor] = thresholds[metric] ?? [1, 2];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

const METRIC_STATUS = {
  good: { label: "Bon", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
  "needs-improvement": { label: "À améliorer", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" },
  poor: { label: "Mauvais", className: "border-red-500/30 bg-red-500/10 text-red-100" },
} as const;

function ScoreCard({ label, score, icon: Icon }: { label: string; score: number; icon: typeof Smartphone }) {
  return (
    <div className={`rounded-xl border p-5 ${scoreTone(score)}`}>
      <div className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4" aria-hidden="true" />{label}</div>
      <div className="mt-3 text-4xl font-semibold tabular-nums text-white">{score}</div>
      <div className="mt-1 text-xs opacity-75">Score Lighthouse sur 100</div>
    </div>
  );
}

function ProbeCard({ label, probe, icon: Icon }: { label: string; probe: OriginProbeMetrics; icon: typeof Smartphone }) {
  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-100"><Icon className="h-4 w-4" aria-hidden="true" />{label}</div>
        <span className={`rounded-md border px-2 py-1 text-xs font-medium ${probe.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-100"}`}>HTTP {probe.status_code}</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-slate-400">En-têtes</dt><dd className="mt-1 font-mono tabular-nums text-white">{probe.ttfb.toFixed(3)} s</dd></div>
        <div><dt className="text-xs text-slate-400">Téléchargement</dt><dd className="mt-1 font-mono tabular-nums text-white">{probe.total.toFixed(3)} s</dd></div>
        <div><dt className="text-xs text-slate-400">Transfert</dt><dd className="mt-1 font-mono tabular-nums text-white">{probe.transfer_kb.toLocaleString("fr-FR")} Ko{probe.transfer_capped ? "+" : ""}</dd></div>
      </dl>
      <p className="mt-4 break-all text-xs leading-5 text-slate-400">{probe.final_url}</p>
    </div>
  );
}

export default function AuditPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
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
        if (list.length > 0) setSelectedSiteId(list[0].id);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Impossible de charger les sites.");
      } finally {
        if (!controller.signal.aborted) setSitesLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    if (!site) return;
    const controller = new AbortController();
    setCacheLoading(true);
    setResult(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/pagespeed?url=${encodeURIComponent(site.url)}&site_id=${site.id}&mode=cache`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 404) return;
        const data = await response.json() as AuditResult & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `Lecture impossible (HTTP ${response.status})`);
        setResult(data);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "La dernière mesure ne peut pas être chargée.");
      } finally {
        if (!controller.signal.aborted) setCacheLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedSiteId, sites]);

  async function runAudit() {
    const site = sites.find((candidate) => candidate.id === selectedSiteId);
    if (!site) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pagespeed?url=${encodeURIComponent(site.url)}&site_id=${site.id}`, { cache: "no-store" });
      const data = await response.json() as AuditResult & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `Audit impossible (HTTP ${response.status})`);
      setResult(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "L’audit PageSpeed a échoué.");
    } finally {
      setLoading(false);
    }
  }

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null;
  const lighthouseResult = result?.measurement_status === "origin_probe" ? null : result;
  const originProbeResult = result?.measurement_status === "origin_probe" ? result : null;
  const rows = lighthouseResult ? [
    ["LCP", "lcp", lighthouseResult.mobile.lcp, lighthouseResult.desktop.lcp, "s"],
    ["CLS", "cls", lighthouseResult.mobile.cls, lighthouseResult.desktop.cls, ""],
    ["FCP", "fcp", lighthouseResult.mobile.fcp, lighthouseResult.desktop.fcp, "s"],
    ["TTFB", "ttfb", lighthouseResult.mobile.ttfb, lighthouseResult.desktop.ttfb, "s"],
  ] as const : [];

  return (
    <ToolPage
      title="Audit PageSpeed"
      eyebrow="Performance technique"
      description="Mesure mobile et desktop avec Google PageSpeed Insights. Si le quota Google est indisponible, un diagnostic réseau réel prend automatiquement le relais sans inventer de score Lighthouse."
      icon={Zap}
      width="standard"
      actions={<button type="button" onClick={() => void runAudit()} disabled={loading || sitesLoading || !selectedSiteId} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Zap className="h-4 w-4" aria-hidden="true" />}{loading ? "Mesure live en cours" : "Lancer une mesure live"}</button>}
    >
      <ToolPanel className="p-4">
        <label htmlFor="pagespeed-site" className="mb-2 block text-sm font-medium text-white">Site à mesurer</label>
        <select id="pagespeed-site" value={selectedSiteId ?? ""} onChange={(event) => setSelectedSiteId(Number(event.target.value))} disabled={sitesLoading} className="h-12 w-full max-w-xl rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-white outline-none focus:ring-2 focus:ring-blue-400">
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name} — {site.url}</option>)}
        </select>
        <p className="mt-2 text-xs leading-5 text-slate-500">Une mesure Lighthouse peut prendre près d’une minute. Le secours réseau mesure réellement la réponse du site mais reste clairement séparé des Core Web Vitals.</p>
      </ToolPanel>

      {error && <ToolAlert tone="error">{error}</ToolAlert>}
      {loading && <ToolLoadingState title="Analyse de performance en cours" description="PageSpeed est tenté en premier; le diagnostic réseau prend le relais si Google limite momentanément le service." rows={4} />}
      {!loading && cacheLoading && <ToolLoadingState title="Lecture de la dernière mesure" description={`Recherche du dernier audit sauvegardé pour ${selectedSite?.name ?? "ce site"}.`} rows={3} />}

      {!loading && !cacheLoading && !result && !error && (
        <ToolPanel><ToolEmptyState icon={Gauge} title="Aucune mesure sauvegardée" description="Lance une mesure live pour enregistrer les scores mobile, desktop et les principaux indicateurs de performance." action={<button type="button" onClick={() => void runAudit()} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500">Mesurer maintenant</button>} /></ToolPanel>
      )}

      {result && !loading && (
        <>
          <ToolAlert tone={result.measurement_status === "live" ? "success" : "info"}>
            {result.measurement_notice ?? (result.measurement_status === "cache" ? "Dernière mesure Lighthouse sauvegardée" : "Nouvelle mesure Lighthouse terminée")}
            {result.checked_at ? ` · ${new Date(result.checked_at).toLocaleString("fr-FR")}` : ""}
          </ToolAlert>
          {lighthouseResult ? (
            <>
              <section aria-label="Scores Lighthouse" className="grid gap-3 sm:grid-cols-2">
                <ScoreCard label="Mobile" score={lighthouseResult.mobile.score} icon={Smartphone} />
                <ScoreCard label="Desktop" score={lighthouseResult.desktop.score} icon={Monitor} />
              </section>
              <ToolPanel className="overflow-hidden" labelledBy="cwv-title">
                <div className="border-b border-slate-800 px-4 py-3"><h2 id="cwv-title" className="font-semibold text-white">Indicateurs de laboratoire</h2><p className="mt-1 text-xs text-slate-500">Ces valeurs Lighthouse ne remplacent pas les données terrain CrUX.</p></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-950/70 text-left text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">Métrique</th><th className="px-3 py-3 text-right font-medium">Mobile</th><th className="px-3 py-3 font-medium">Statut mobile</th><th className="px-3 py-3 text-right font-medium">Desktop</th><th className="px-4 py-3 font-medium">Statut desktop</th></tr></thead>
                    <tbody className="divide-y divide-slate-800">
                      {rows.map(([label, metric, mobile, desktop, unit]) => {
                        const mobileStatus = METRIC_STATUS[metricStatus(metric, mobile)];
                        const desktopStatus = METRIC_STATUS[metricStatus(metric, desktop)];
                        const decimals = metric === "cls" ? 3 : 2;
                        return <tr key={metric}><td className="px-4 py-3 font-medium text-white">{label}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{mobile.toFixed(decimals)}{unit}</td><td className="px-3 py-3"><span className={`rounded-md border px-2 py-1 text-xs ${mobileStatus.className}`}>{mobileStatus.label}</span></td><td className="px-3 py-3 text-right font-mono tabular-nums">{desktop.toFixed(decimals)}{unit}</td><td className="px-4 py-3"><span className={`rounded-md border px-2 py-1 text-xs ${desktopStatus.className}`}>{desktopStatus.label}</span></td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </ToolPanel>
            </>
          ) : originProbeResult ? (
            <>
              <section aria-label="Diagnostic réseau de secours" className="grid gap-3 sm:grid-cols-2">
                <ProbeCard label="Mobile" probe={originProbeResult.origin_probe.mobile} icon={Smartphone} />
                <ProbeCard label="Desktop" probe={originProbeResult.origin_probe.desktop} icon={Monitor} />
              </section>
              <ToolAlert tone="info">LCP, CLS, FCP et le score sur 100 ne sont affichés que lorsqu’ils proviennent réellement de Lighthouse. Le diagnostic de secours mesure ici le temps des en-têtes, le téléchargement et le poids transféré.</ToolAlert>
            </>
          ) : null}
        </>
      )}
    </ToolPage>
  );
}
