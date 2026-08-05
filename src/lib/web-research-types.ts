export type WebSearchProvider = "bing_rss" | "duckduckgo_html";

export type ResearchDepth = "quick" | "deep";
export type ResearchFocus = "general" | "competitors" | "content";
export type ResearchIntent = "informational" | "commercial" | "transactional" | "navigational";

export interface WebSearchResult {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  providers: WebSearchProvider[];
  positions: Partial<Record<WebSearchProvider, number>>;
  matched_queries?: string[];
  retrieval_score?: number;
}

export interface ResearchSource extends WebSearchResult {
  id: string;
  fetch_status: "ok" | "search_only";
  description: string;
  headings: string[];
  schema_types: string[];
  word_count: number;
  excerpt: string;
  source_score?: number;
  source_signals?: string[];
}

export interface CrawledResearchSource extends ResearchSource {
  body_text: string;
}

export interface ResearchEvidence {
  source_id: string;
  claim: string;
  score: number;
}

export interface ResearchQueryStep {
  id: string;
  query: string;
  purpose: "primary" | "overview" | "questions" | "comparison" | "evidence" | "expansion";
  round: 1 | 2;
  weight: number;
  result_count: number;
  provider_status: Record<WebSearchProvider, "ok" | "empty" | "failed">;
}

export interface ResearchClaimSupport {
  source_id: string;
  excerpt: string;
  score: number;
}

export interface ResearchClaim {
  id: string;
  statement: string;
  support: ResearchClaimSupport[];
  source_ids: string[];
  independent_domains: number;
  confidence: "corroborated" | "single_source";
  score: number;
}

export interface ResearchKeywordOpportunity {
  keyword: string;
  intent: ResearchIntent;
  source_ids: string[];
  source_count: number;
  evidence_score: number;
  kind: "core" | "supporting" | "question";
}

export interface ResearchKeywordCluster {
  id: string;
  label: string;
  intent: ResearchIntent;
  keywords: ResearchKeywordOpportunity[];
  source_ids: string[];
  evidence_score: number;
}

export interface ResearchCoverage {
  queries_planned: number;
  queries_with_results: number;
  results_discovered: number;
  sources_selected: number;
  sources_crawled: number;
  independent_domains: number;
  corroborated_claims: number;
}

export interface WebResearchReport {
  query: string;
  locale: string;
  generated_at: string;
  data_status: "complete" | "partial" | "unavailable";
  search_providers: Record<WebSearchProvider, "ok" | "empty" | "failed">;
  answer: string;
  evidence: ResearchEvidence[];
  sources: ResearchSource[];
  engine_version?: "local-research-v2";
  depth?: ResearchDepth;
  focus?: ResearchFocus;
  inferred_intent?: ResearchIntent;
  query_plan?: ResearchQueryStep[];
  claims?: ResearchClaim[];
  keyword_clusters?: ResearchKeywordCluster[];
  coverage?: ResearchCoverage;
  metric_boundaries?: {
    search_volume: "not_measured";
    keyword_difficulty: "not_measured";
    google_position: "not_measured";
    public_search_positions: "bing_ddg_only";
  };
}

export interface WebResearchOptions {
  locale?: string;
  maxSources?: number;
  maxQueries?: number;
  depth?: ResearchDepth;
  focus?: ResearchFocus;
}
