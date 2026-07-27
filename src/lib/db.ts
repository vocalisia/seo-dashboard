import { neon } from "@neondatabase/serverless";

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getSQL() {
  return neon(process.env.DATABASE_URL!);
}

let schemaReady: Promise<void> | null = null;

export function ensureSchemaOnce(): Promise<void> {
  schemaReady ??= ensureSchema().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function initDB() {
  const sql = getSQL();

  await sql`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      url VARCHAR(500) NOT NULL,
      ga_property_id VARCHAR(50),
      gsc_property VARCHAR(500),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_daily (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      date DATE NOT NULL,
      sessions INTEGER DEFAULT 0,
      users INTEGER DEFAULT 0,
      new_users INTEGER DEFAULT 0,
      pageviews INTEGER DEFAULT 0,
      bounce_rate DECIMAL(5,2),
      avg_session_duration DECIMAL(10,2),
      organic_sessions INTEGER DEFAULT 0,
      direct_sessions INTEGER DEFAULT 0,
      referral_sessions INTEGER DEFAULT 0,
      social_sessions INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(site_id, date)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS search_console_data (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      date DATE NOT NULL,
      query VARCHAR(500),
      page VARCHAR(1000),
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr DECIMAL(5,4),
      position DECIMAL(6,2),
      country VARCHAR(10),
      device VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tracked_keywords (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      keyword VARCHAR(500) NOT NULL,
      target_url VARCHAR(1000),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_analytics_site_date ON analytics_daily(site_id, date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gsc_site_date ON search_console_data(site_id, date)`;

  await sql`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      week_start DATE NOT NULL,
      summary TEXT,
      recommendations TEXT,
      top_opportunities JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(site_id, week_start)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_site ON weekly_reports(site_id, week_start DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS autopilot_runs (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      keyword VARCHAR(500),
      article_title VARCHAR(500),
      github_url VARCHAR(1000),
      image_url VARCHAR(1000),
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_autopilot_site ON autopilot_runs(site_id, created_at DESC)`;
  await sql`ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS published_url VARCHAR(1500)`;

  await sql`
    CREATE TABLE IF NOT EXISTS pagespeed_scores (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      url VARCHAR(1000),
      mobile_score INTEGER,
      desktop_score INTEGER,
      mobile_lcp DECIMAL(6,2),
      desktop_lcp DECIMAL(6,2),
      mobile_cls DECIMAL(6,3),
      desktop_cls DECIMAL(6,3),
      mobile_fcp DECIMAL(6,2),
      desktop_fcp DECIMAL(6,2),
      mobile_ttfb DECIMAL(6,2),
      desktop_ttfb DECIMAL(6,2),
      checked_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS gsc_links (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      linking_domain VARCHAR(500),
      target_page VARCHAR(1000),
      link_count INTEGER,
      synced_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Migrations (idempotent) for multi-country / multi-language
  await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS target_languages TEXT[] DEFAULT ARRAY['fr']`;
  await sql`ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'fr'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_gsc_country ON search_console_data(site_id, country, date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_autopilot_lang ON autopilot_runs(site_id, language, created_at DESC)`;

  await ensureOpportunitySchema();
  await ensureSchema();
}

// Idempotent migrations for new features (keyword planner import, trends, pagespeed cron).
// Safe to call multiple times. Each statement uses IF NOT EXISTS guards.
export async function ensureSchema(): Promise<void> {
  const sql = getSQL();

  // tracked_keywords — columns referenced by Keyword Planner import + tracker UI
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS market VARCHAR(8)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS volume_fr INTEGER`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS volume_ch INTEGER`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS volume_market INTEGER`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS volume_source VARCHAR(60)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS confidence DECIMAL(4,3)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS competition VARCHAR(20)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS cpc_low DECIMAL(8,2)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS cpc_high DECIMAL(8,2)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS current_position DECIMAL(6,2)`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS current_impressions INTEGER`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS current_clicks INTEGER`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS position_history JSONB DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS volume_updated_at TIMESTAMP`;

  // Idempotent UPSERT match key: (site_id, LOWER(keyword))
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_keywords_site_kw_lower
      ON tracked_keywords(site_id, LOWER(keyword))
  `;

  // keyword_trends — 12-month relative-interest series from Google Trends
  await sql`
    CREATE TABLE IF NOT EXISTS keyword_trends (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      keyword VARCHAR(500) NOT NULL,
      geo VARCHAR(8) NOT NULL,
      trend_data JSONB NOT NULL,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_trends_unique
      ON keyword_trends(COALESCE(site_id, 0), LOWER(keyword), geo)
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_keyword_trends_fetched ON keyword_trends(fetched_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS search_console_query_data (
      id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      clicks INT NOT NULL DEFAULT 0,
      impressions INT NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scqd_natural_key
      ON search_console_query_data (site_id, date, query, country, device)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_scqd_site_query_country
      ON search_console_query_data (site_id, query, country)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_scqd_site_date
      ON search_console_query_data (site_id, date)
  `;

  // Preserve full GSC query/page dimensions; Google can return values beyond legacy VARCHAR limits.
  await sql`ALTER TABLE search_console_data ALTER COLUMN query TYPE TEXT`;
  await sql`ALTER TABLE search_console_data ALTER COLUMN page TYPE TEXT`;

  // pagespeed_scores — strategy column so daily cron stores per-strategy rows + indices

  await sql`ALTER TABLE pagespeed_scores ADD COLUMN IF NOT EXISTS strategy VARCHAR(10)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pagespeed_site_checked ON pagespeed_scores(site_id, checked_at DESC)`;

  // competitor_llm_scan — per-competitor LLM-bot/SEO readiness scan (cache 7d)
  await sql`
    CREATE TABLE IF NOT EXISTS competitor_llm_scan (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      competitor_domain VARCHAR(500) NOT NULL,
      llms_txt_present BOOLEAN DEFAULT false,
      llms_txt_content TEXT,
      ai_bots_allowed JSONB DEFAULT '[]'::jsonb,
      schemas_detected JSONB DEFAULT '[]'::jsonb,
      llm_readiness_score INTEGER DEFAULT 0,
      raw_findings JSONB DEFAULT '{}'::jsonb,
      scanned_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_llm_scan_unique
      ON competitor_llm_scan(site_id, LOWER(competitor_domain))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_competitor_llm_scan_scanned ON competitor_llm_scan(scanned_at DESC)`;

  // rich_results_cache — 24h cache of Google Rich Results Test API responses
  await sql`
    CREATE TABLE IF NOT EXISTS rich_results_cache (
      id SERIAL PRIMARY KEY,
      url VARCHAR(1500) NOT NULL,
      google_response JSONB NOT NULL,
      cached_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_rich_results_cache_url ON rich_results_cache(url, cached_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rich_results_cache_cached ON rich_results_cache(cached_at DESC)`;

  // brand_mentions — Reddit + HackerNews brand mention monitoring
  await sql`
    CREATE TABLE IF NOT EXISTS brand_mentions (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      source VARCHAR(20) NOT NULL,
      title TEXT NOT NULL,
      url VARCHAR(1000),
      score INTEGER DEFAULT 0,
      created_at_external TIMESTAMP,
      body TEXT,
      sentiment VARCHAR(10) DEFAULT 'neutral',
      scanned_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_mentions_unique
      ON brand_mentions(site_id, source, COALESCE(url, ''), LEFT(title, 200))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_brand_mentions_site ON brand_mentions(site_id, scanned_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_brand_mentions_external ON brand_mentions(site_id, created_at_external DESC)`;

  // academic_mentions — OpenAlex academic citations
  await sql`
    CREATE TABLE IF NOT EXISTS academic_mentions (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      source_url VARCHAR(1500),
      title TEXT NOT NULL,
      authors JSONB DEFAULT '[]'::jsonb,
      year INTEGER,
      doi VARCHAR(500),
      cited_by_count INTEGER DEFAULT 0,
      source_type VARCHAR(50),
      source_domain VARCHAR(255),
      scanned_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_mentions_unique
      ON academic_mentions(site_id, COALESCE(doi, source_url, LEFT(title, 200)))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_academic_mentions_site ON academic_mentions(site_id, cited_by_count DESC)`;
}

export async function ensureOpportunitySchema() {
  const sql = getSQL();

  await sql`
    CREATE TABLE IF NOT EXISTS market_opportunities (
      id SERIAL PRIMARY KEY,
      niche VARCHAR(200),
      reason TEXT,
      site_type VARCHAR(50),
      core_keywords JSONB,
      monthly_volume INTEGER,
      competition VARCHAR(20),
      monetization VARCHAR(50),
      projected_traffic_6m INTEGER,
      projected_revenue_6m INTEGER,
      suggested_domains JSONB,
      seed_articles JSONB,
      target_countries JSONB,
      target_languages JSONB,
      competitors JSONB,
      confidence_score INTEGER,
      status VARCHAR(20) DEFAULT 'pending',
      validation JSONB DEFAULT '{}'::jsonb,
      score_breakdown JSONB,
      serp_evidence JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Keep ALTER TABLE safeguards for existing deployed databases.
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS target_countries JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS target_languages JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS competitors JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS validation JSONB`;
  await sql`ALTER TABLE market_opportunities ALTER COLUMN validation SET DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS business_model JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS success_rate INTEGER`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS revenue_timeline JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS signal_source VARCHAR(50)`;
  await sql`ALTER TABLE market_opportunities ALTER COLUMN signal_source TYPE VARCHAR(200)`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS momentum_pct DECIMAL(8,2)`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS average_position DECIMAL(8,2)`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS opportunity_type VARCHAR(50)`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS sample_queries JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS score_breakdown JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS serp_evidence JSONB`;

  // v2 enrichment columns (2026-05-27)
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS launch_plan JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS time_to_rank_months INTEGER`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS why_now JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS revenue_range JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS domain_available JSONB`;

  await sql`CREATE INDEX IF NOT EXISTS idx_market_opportunities_confidence ON market_opportunities(confidence_score DESC, created_at DESC)`;

  // Deep research cache (7d TTL)
  await sql`
    CREATE TABLE IF NOT EXISTS scanner_deep_research (
      id SERIAL PRIMARY KEY,
      niche_key VARCHAR(300) NOT NULL UNIQUE,
      keyword VARCHAR(500) NOT NULL,
      research_json JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scanner_deep_research_expires ON scanner_deep_research(expires_at DESC)`;

  // Minimal content plan table for "Launch this niche" stub
  await sql`
    CREATE TABLE IF NOT EXISTS content_plan (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      opportunity_id INTEGER REFERENCES market_opportunities(id),
      title VARCHAR(500) NOT NULL,
      target_keyword VARCHAR(500),
      status VARCHAR(30) DEFAULT 'planned',
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_plan_site ON content_plan(site_id, priority DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_content_plan_opp ON content_plan(opportunity_id)`;
}
