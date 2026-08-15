"use client";

import Link from "next/link";
import {
  Activity, AlertTriangle, CheckCircle2, Crosshair, Database, Gauge,
  MousePointerClick, RefreshCw, Search, ShieldCheck,
  type LucideIcon,
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

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "blue" | "cyan" | "emerald" | "amber" | "violet";
}

const TONES = {
  blue: "border-blue-500/20 bg-blue-500/[0.06] text-blue-200",
  cyan: "border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-200",
  emerald: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200",
  amber: "border-amber-500/20 bg-amber-500/[0.06] text-amber-100",
  violet: "border-violet-500/20 bg-violet-500/[0.06] text-violet-200",
};

function MetricCard({ label, value, detail, icon: Icon, tone }: MetricCardProps) {
  return (
    <div className={`min-w-0 rounded-xl border p-4 ${TONES[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-1 truncate text-xs text-slate-400" title={detail}>{detail}</div>
    </div>
  );
}

export function DashboardHealthOverview(props: DashboardHealthOverviewProps) {
  const summary = summarizeDashboardHealth(props.sites);
  const issueSites = props.sites
    .map((site) => ({ site, issues: dashboardSiteIssues(site) }))
    .filter(({ issues }) => issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length || a.site.name.localeCompare(b.site.name));

  const metrics: MetricCardProps[] = [
    {
      label: "Domaines opérationnels",
      value: summary.totalSites ? `${summary.healthySites}/${summary.totalSites}` : "—",
      detail: "Aucune alerte GSC, GA4 ou Keyword Planner",
      icon: CheckCircle2,
      tone: "emerald",
    },
    {
      label: "Domaines à vérifier",
      value: summary.issueSites.toLocaleString("fr-FR"),
      detail: `${summary.totalIssues} alertes actives au total`,
      icon: AlertTriangle,
      tone: summary.issueSites > 0 ? "amber" : "emerald",
    },
    {
      label: `Clics GSC · ${props.period} j`,
      value: props.totalClicks.toLocaleString("fr-FR"),
      detail: `${Math.round(props.totalClicks / Number(props.period || 1)).toLocaleString("fr-FR")} par jour en moyenne`,
      icon: MousePointerClick,
      tone: "blue",
    },
    {
      label: `Impressions GSC · ${props.period} j`,
      value: props.totalImpressions.toLocaleString("fr-FR"),
      detail: `${Math.round(props.totalImpressions / Number(props.period || 1)).toLocaleString("fr-FR")} par jour en moyenne`,
      icon: Search,
      tone: "violet",
    },
    {
      label: "Position GSC pondérée",
      value: props.weightedPosition == null ? "—" : props.weightedPosition.toFixed(1),
      detail: `${props.positionedSites} domaines avec impressions`,
      icon: Gauge,
      tone: "cyan",
    },
    {
      label: "Mots-clés dans le Top 10",
      value: summary.top10Keywords.toLocaleString("fr-FR"),
      detail: "Requêtes GSC observées sur 7 jours",
      icon: Crosshair,
      tone: "emerald",
    },
    {
      label: "Mots-clés avec volume KP",
      value: summary.importedKeywordVolumes.toLocaleString("fr-FR"),
      detail: `${summary.missingKeywordVolumes.toLocaleString("fr-FR")} mots-clés encore sans volume`,
      icon: Database,
      tone: "blue",
    },
    {
      label: "Mouvements exploitables",
      value: summary.gainCandidates.toLocaleString("fr-FR"),
      detail: "Écarts de position mesurés entre périodes",
      icon: Activity,
      tone: "violet",
    },
  ];

  return (
    <section className="px-4 pt-4 sm:px-6" aria-labelledby="portfolio-health-title">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-8">
          {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.55fr)]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="portfolio-health-title" className="text-sm font-semibold text-white">Santé des données</h2>
                <p className="mt-1 text-xs text-slate-400">Positions : requêtes Google Search Console. Volumes : imports Keyword Planner identifiés.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/control" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Centre de contrôle
                </Link>
                <button type="button" onClick={props.onRefresh} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label="Rafraîchir la santé des données">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"><strong className="text-white">{summary.gscIssueSites}</strong> domaine(s) avec alerte GSC</div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"><strong className="text-white">{summary.ga4IssueSites}</strong> domaine(s) avec alerte GA4</div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300"><strong className="text-white">{summary.kpIssueSites}</strong> domaine(s) sans volume KP</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Anomalies prioritaires</h2>
              <span className={`text-xs ${props.serviceWarning ? "text-amber-300" : "text-slate-500"}`}>Services : {props.serviceTiming}</span>
            </div>
            <div className="mt-3 space-y-2">
              {issueSites.slice(0, 5).map(({ site, issues }) => (
                <div key={site.id} className="flex min-h-11 flex-col justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="truncate text-sm font-medium text-slate-100">{site.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {issues.slice(0, 2).map((issue) => (
                      <span key={issue} className={`rounded-md border px-2 py-1 text-[11px] ${dashboardIssueClass(issue)}`}>{dashboardIssueLabel(issue)}</span>
                    ))}
                    {issues.length > 2 && <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300">+{issues.length - 2}</span>}
                  </div>
                </div>
              ))}
              {issueSites.length === 0 && (
                <div className="flex min-h-20 items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] text-sm text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Aucune anomalie active.
                </div>
              )}
              {issueSites.length > 5 && <div className="text-right text-xs text-slate-500">{issueSites.length - 5} autre(s) domaine(s) à vérifier</div>}
              {props.sites.length === 0 && <div className="py-5 text-center text-sm text-slate-500">Contrôle en cours de chargement…</div>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
