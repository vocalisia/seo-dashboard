export type DashboardIssueCode =
  | "gsc_not_configured"
  | "gsc_no_query_data"
  | "gsc_stale"
  | "ga4_no_daily_data"
  | "ga4_stale"
  | "ga4_incomplete"
  | "kp_missing"
  | string;

export interface DashboardQualitySite {
  id: number;
  name: string;
  latest_gsc_date: string | null;
  positioned_keywords_30d: number;
  top10_keywords_7d: number;
  tracked_keywords: number;
  kp_volumes_imported: number;
  kp_volumes_missing: number;
  gain_candidates: number;
  latest_ga4_date: string | null;
  users_30d: number;
  status: DashboardIssueCode | "ok";
  issues?: DashboardIssueCode[];
}

export interface DashboardHealthSummary {
  totalSites: number;
  healthySites: number;
  issueSites: number;
  totalIssues: number;
  gscIssueSites: number;
  ga4IssueSites: number;
  kpIssueSites: number;
  importedKeywordVolumes: number;
  missingKeywordVolumes: number;
  gainCandidates: number;
  top10Keywords: number;
}

const ISSUE_LABELS: Record<string, string> = {
  gsc_not_configured: "GSC non configurée",
  gsc_no_query_data: "Aucune requête GSC",
  gsc_stale: "GSC en retard",
  ga4_no_daily_data: "GA4 sans données",
  ga4_stale: "GA4 en retard",
  ga4_incomplete: "Historique GA4 incomplet",
  kp_missing: "Volumes Keyword Planner absents",
  ok: "Opérationnel",
};

export function dashboardIssueLabel(issue: string): string {
  return ISSUE_LABELS[issue] ?? issue.replaceAll("_", " ");
}

export function dashboardSiteIssues(site: DashboardQualitySite): DashboardIssueCode[] {
  if (Array.isArray(site.issues) && site.issues.length > 0) {
    return [...new Set(site.issues.filter((issue) => issue && issue !== "ok"))];
  }
  return site.status && site.status !== "ok" ? [site.status] : [];
}

export function dashboardSiteStatusLabel(site: DashboardQualitySite): string {
  const issues = dashboardSiteIssues(site);
  if (issues.length === 0) return "Opérationnel";
  if (issues.length === 1) return dashboardIssueLabel(issues[0]);
  return `${issues.length} alertes`;
}

export function dashboardIssueClass(issue: string): string {
  if (issue === "gsc_not_configured" || issue === "gsc_no_query_data") {
    return "border-red-500/35 bg-red-500/10 text-red-200";
  }
  if (issue.startsWith("gsc_") || issue.startsWith("ga4_") || issue === "kp_missing") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-100";
  }
  return "border-slate-600 bg-slate-800 text-slate-200";
}

export function dashboardSiteStatusClass(site: DashboardQualitySite): string {
  const issues = dashboardSiteIssues(site);
  return issues.length === 0
    ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
    : dashboardIssueClass(issues[0]);
}

export function summarizeDashboardHealth(sites: DashboardQualitySite[]): DashboardHealthSummary {
  const withIssues = sites.map((site) => ({ site, issues: dashboardSiteIssues(site) }));
  const hasIssuePrefix = (issues: string[], prefix: string) => issues.some((issue) => issue.startsWith(prefix));

  return {
    totalSites: sites.length,
    healthySites: withIssues.filter(({ issues }) => issues.length === 0).length,
    issueSites: withIssues.filter(({ issues }) => issues.length > 0).length,
    totalIssues: withIssues.reduce((sum, { issues }) => sum + issues.length, 0),
    gscIssueSites: withIssues.filter(({ issues }) => hasIssuePrefix(issues, "gsc_")).length,
    ga4IssueSites: withIssues.filter(({ issues }) => hasIssuePrefix(issues, "ga4_")).length,
    kpIssueSites: withIssues.filter(({ issues }) => issues.includes("kp_missing")).length,
    importedKeywordVolumes: sites.reduce((sum, site) => sum + Number(site.kp_volumes_imported || 0), 0),
    missingKeywordVolumes: sites.reduce((sum, site) => sum + Number(site.kp_volumes_missing || 0), 0),
    gainCandidates: sites.reduce((sum, site) => sum + Number(site.gain_candidates || 0), 0),
    top10Keywords: sites.reduce((sum, site) => sum + Number(site.top10_keywords_7d || 0), 0),
  };
}

export function weightedDashboardPosition(
  sites: Array<{ avg_position_30d: number; gsc_impressions_30d: number }>,
): number | null {
  const positioned = sites.filter((site) => {
    const position = Number(site.avg_position_30d);
    const impressions = Number(site.gsc_impressions_30d);
    return Number.isFinite(position) && position > 0 && Number.isFinite(impressions) && impressions > 0;
  });
  const impressions = positioned.reduce((sum, site) => sum + Number(site.gsc_impressions_30d), 0);
  if (impressions === 0) return null;
  return positioned.reduce(
    (sum, site) => sum + Number(site.avg_position_30d) * Number(site.gsc_impressions_30d),
    0,
  ) / impressions;
}
