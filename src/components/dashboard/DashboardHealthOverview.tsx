"use client";

import Link from "next/link";
import {
  CheckCircle2, Crosshair, Gauge, MousePointerClick,
  RefreshCw, Search, ShieldCheck, type LucideIcon,
} from "lucide-react";
import {
  dashboardIssueClass,
  dashboardIssueLabel,
  dashboardSiteIssues,
  summarizeDashboardHealth,
  type DashboardQualitySite,
} from "@/lib/dashboard-quality";

interface DashboardHealthOverviewProps {
  sites: DashboardQualitySite[];
  period: string;
  totalClicks: number;
  totalImpressions: number;
  weightedPosition: number | null;
  positionedSites: number;
  serviceTiming: string;
  serviceWarning: boolean;
  onRefresh: () => void;
}

function PrimaryMetric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: LucideIcon }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon className="h-4 w-4 text-blue-300" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight text-white">{value}</div>
      <div className="mt-1 truncate text-xs text-slate-500" title={detail}>{detail}</div>
    </div>
  );
}

export function DashboardHealthOverview(props: DashboardHealthOverviewProps) {
  const summary = summarizeDashboardHealth(props.sites);
  const qualityReady = props.sites.length > 0;
  const issueSites = props.sites
    .map((site) => ({ site, issues: dashboardSiteIssues(site) }))
    .filter(({ issues }) => issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length || a.site.name.localeCompare(b.site.name));

  return (
    <section className="px-4 pt-4 sm:px-6" aria-labelledby="portfolio-health-title">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PrimaryMetric label={`Clics GSC · ${props.period} j`} value={props.totalClicks.toLocaleString("fr-FR")} detail={`${Math.round(props.totalClicks / Number(props.period || 1)).toLocaleString("fr-FR")} par jour en moyenne`} icon={MousePointerClick} />
          <PrimaryMetric label={`Impressions GSC · ${props.period} j`} value={props.totalImpressions.toLocaleString("fr-FR")} detail="Requêtes réellement observées dans Search Console" icon={Search} />
          <PrimaryMetric label="Position GSC pondérée" value={props.weightedPosition == null ? "—" : props.weightedPosition.toFixed(1)} detail={`${props.positionedSites} domaines avec impressions`} icon={Gauge} />
          <PrimaryMetric label={`Mots-clés Top 10 · ${props.period} j`} value={qualityReady ? summary.top10Keywords.toLocaleString("fr-FR") : "—"} detail={qualityReady ? "Requêtes GSC observées sur la période" : "Qualité des données en chargement"} icon={Crosshair} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Couverture des sources">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{qualityReady ? `${summary.healthySites}/${summary.totalSites}` : "—"}</strong> domaines sans alerte de source</div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{qualityReady ? summary.issueSites : "—"}</strong> domaines à vérifier</div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{qualityReady ? summary.importedKeywordVolumes.toLocaleString("fr-FR") : "—"}</strong> mots-clés avec volume importé</div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{qualityReady ? summary.gainCandidates.toLocaleString("fr-FR") : "—"}</strong> mouvements mesurés</div>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="portfolio-health-title" className="text-sm font-semibold text-white">Couverture des données</h2>
                <p className="mt-1 text-xs leading-5 text-slate-400">Positions et clics : Google Search Console. Volumes : uniquement les imports Keyword Planner identifiés.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/control" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Contrôler les services
                </Link>
                <button type="button" onClick={props.onRefresh} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label="Rafraîchir la couverture des données">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            {qualityReady ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-xs text-slate-300"><strong className="block text-lg tabular-nums text-white">{summary.gscIssueSites}</strong> domaine(s) avec alerte GSC</div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-xs text-slate-300"><strong className="block text-lg tabular-nums text-white">{summary.ga4IssueSites}</strong> domaine(s) avec alerte GA4</div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-xs text-slate-300"><strong className="block text-lg tabular-nums text-white">{summary.kpIssueSites}</strong> domaine(s) sans volume importé</div>
              </div>
            ) : (
              <div role="status" className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Chargement de la couverture des données">
                {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-800/70 motion-reduce:animate-none" />)}
              </div>
            )}
            <div className={`mt-3 text-[11px] ${props.serviceWarning ? "text-amber-300" : "text-slate-600"}`}>Temps de réponse des services : {props.serviceTiming}</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Anomalies prioritaires</h2>
              {qualityReady && <span className="text-xs tabular-nums text-slate-500">{summary.totalIssues} alerte(s)</span>}
            </div>
            <div className="mt-3 space-y-2">
              {issueSites.slice(0, 5).map(({ site, issues }) => (
                <div key={site.id} className="flex min-h-11 flex-col justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium text-slate-100" title={site.name}>{site.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {issues.slice(0, 2).map((issue) => <span key={issue} className={`rounded-md border px-2 py-1 text-[11px] ${dashboardIssueClass(issue)}`}>{dashboardIssueLabel(issue)}</span>)}
                    {issues.length > 2 && <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300">+{issues.length - 2}</span>}
                  </div>
                </div>
              ))}
              {qualityReady && issueSites.length === 0 && (
                <div className="flex min-h-20 items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Aucune anomalie active.</div>
              )}
              {!qualityReady && <div role="status" className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-lg bg-slate-800/70 motion-reduce:animate-none" />)}</div>}
              {issueSites.length > 5 && <div className="text-right text-xs text-slate-500">{issueSites.length - 5} autre(s) domaine(s) à vérifier</div>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
