export type DashboardToolGroupId = "pilotage" | "research" | "technical" | "content" | "data";

export type DashboardToolIcon =
  | "dashboard" | "overview" | "positions" | "tracker" | "control" | "reports"
  | "weekly" | "alerts" | "calendar" | "refresh" | "opportunities" | "competitors"
  | "scanner" | "keywords" | "tracked" | "countries" | "compare" | "striking"
  | "backlinks" | "authority" | "audit" | "health" | "links" | "pagerank"
  | "schema" | "index" | "cannibal" | "crossDomain" | "ctr" | "decay"
  | "autopilot" | "roi" | "contentPlan" | "clusters" | "aiVisibility"
  | "aiPrompts" | "aio" | "youtube" | "import" | "ga4" | "traffic" | "logs";

export interface DashboardTool {
  href: string;
  label: string;
  description: string;
  group: DashboardToolGroupId;
  icon: DashboardToolIcon;
  keywords?: string[];
}

export const DASHBOARD_TOOL_GROUPS: Array<{
  id: DashboardToolGroupId;
  label: string;
  description: string;
}> = [
  { id: "pilotage", label: "Pilotage", description: "Suivi, alertes et reporting" },
  { id: "research", label: "Recherche", description: "Marché, mots-clés et concurrents" },
  { id: "technical", label: "Technique", description: "Crawl, architecture et qualité" },
  { id: "content", label: "Contenu & IA", description: "Production, visibilité et plans" },
  { id: "data", label: "Données", description: "Imports, analytics et journaux" },
];

export const DASHBOARD_TOOLS: DashboardTool[] = [
  { href: "/dashboard", label: "Vue principale", description: "Cockpit du portefeuille", group: "pilotage", icon: "dashboard", keywords: ["accueil"] },
  { href: "/overview", label: "Vue portfolio", description: "Comparaison globale des domaines", group: "pilotage", icon: "overview" },
  { href: "/positions", label: "Positions GSC", description: "Crawl et mots-clés par domaine", group: "pilotage", icon: "positions", keywords: ["crawl", "classement"] },
  { href: "/tracker", label: "Tracker SERP", description: "Historique des mots-clés suivis", group: "pilotage", icon: "tracker" },
  { href: "/control", label: "Centre de contrôle", description: "État des sources et automatisations", group: "pilotage", icon: "control" },
  { href: "/reports", label: "Rapports", description: "Rapports SEO consolidés", group: "pilotage", icon: "reports" },
  { href: "/weekly", label: "Actions hebdo", description: "Priorités de la semaine", group: "pilotage", icon: "weekly" },
  { href: "/alerts", label: "Alertes", description: "Anomalies et actions urgentes", group: "pilotage", icon: "alerts" },
  { href: "/calendar", label: "Calendrier", description: "Planification éditoriale", group: "pilotage", icon: "calendar" },
  { href: "/refresh", label: "Rafraîchissement", description: "Contenus en déclin à remettre à jour", group: "pilotage", icon: "refresh" },

  { href: "/opportunities", label: "Opportunités", description: "Niches et requêtes à potentiel", group: "research", icon: "opportunities" },
  { href: "/competitors", label: "Concurrents", description: "Écarts de mots-clés et preuves", group: "research", icon: "competitors" },
  { href: "/scanner", label: "Scanner marché", description: "Exploration de secteurs", group: "research", icon: "scanner" },
  { href: "/keywords-pro", label: "Mots-clés Pro", description: "Recherche et segmentation", group: "research", icon: "keywords" },
  { href: "/tracked-keywords", label: "Mots-clés suivis", description: "Cibles suivies par domaine", group: "research", icon: "tracked" },
  { href: "/countries", label: "Pays", description: "Analyse par marché", group: "research", icon: "countries" },
  { href: "/compare", label: "Comparer", description: "Comparaison de domaines", group: "research", icon: "compare" },
  { href: "/striking-distance", label: "Proche du Top 10", description: "Requêtes à distance de frappe", group: "research", icon: "striking" },
  { href: "/backlinks", label: "Backlinks", description: "Liens entrants observés", group: "research", icon: "backlinks" },
  { href: "/authority", label: "Autorité thématique", description: "Couverture des sujets", group: "research", icon: "authority" },

  { href: "/audit", label: "Audit SEO", description: "Contrôles techniques essentiels", group: "technical", icon: "audit" },
  { href: "/health", label: "Santé SEO", description: "Score et incidents du site", group: "technical", icon: "health" },
  { href: "/internal-links", label: "Maillage interne", description: "Liens, ancres et opportunités", group: "technical", icon: "links" },
  { href: "/pagerank", label: "PageRank interne", description: "Distribution de l'autorité interne", group: "technical", icon: "pagerank" },
  { href: "/schema", label: "Données structurées", description: "Audit des schémas", group: "technical", icon: "schema" },
  { href: "/index-bloat", label: "Indexation excessive", description: "Pages faibles ou inutiles", group: "technical", icon: "index" },
  { href: "/cannibalization-hhi", label: "Cannibalisation", description: "Concurrence entre pages", group: "technical", icon: "cannibal" },
  { href: "/cross-domain-cannibal", label: "Conflits interdomaines", description: "Cannibalisation du portefeuille", group: "technical", icon: "crossDomain" },
  { href: "/ctr-anomaly", label: "Anomalies CTR", description: "CTR inhabituel par requête", group: "technical", icon: "ctr" },
  { href: "/content-decay", label: "Déclin de contenu", description: "Pages qui perdent en visibilité", group: "technical", icon: "decay" },

  { href: "/autopilot", label: "Autopilot", description: "Automatisations SEO contrôlées", group: "content", icon: "autopilot" },
  { href: "/autopilot/roi", label: "Impact Autopilot", description: "Résultats mesurés des actions", group: "content", icon: "roi" },
  { href: "/content-plan", label: "Plan de contenu", description: "Priorités et production", group: "content", icon: "contentPlan" },
  { href: "/clusters", label: "Clusters", description: "Regroupements sémantiques", group: "content", icon: "clusters" },
  { href: "/ai-visibility", label: "Visibilité IA", description: "Présence dans les réponses IA", group: "content", icon: "aiVisibility" },
  { href: "/ai-prompts", label: "Prompts IA", description: "Questions et citations à suivre", group: "content", icon: "aiPrompts" },
  { href: "/aio-detector", label: "Signaux AIO", description: "Candidats CTR à vérifier dans la SERP", group: "content", icon: "aio" },
  { href: "/youtube", label: "YouTube", description: "Analyse de visibilité vidéo", group: "content", icon: "youtube" },

  { href: "/keyword-planner-import", label: "Import Keyword Planner", description: "Volumes sourcés par marché", group: "data", icon: "import" },
  { href: "/ga4-audit", label: "Audit GA4", description: "Mesure et configuration Analytics", group: "data", icon: "ga4" },
  { href: "/traffic-by-country", label: "Trafic par pays", description: "Répartition géographique GA4", group: "data", icon: "traffic" },
  { href: "/logs", label: "Logs de crawl", description: "Passages observés des robots", group: "data", icon: "logs" },
];

export function dashboardToolForPath(pathname: string): DashboardTool | undefined {
  return [...DASHBOARD_TOOLS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((tool) => pathname === tool.href || pathname.startsWith(`${tool.href}/`));
}
