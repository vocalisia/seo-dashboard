import { neon } from "@neondatabase/serverless";

export function getSQL() {
  return neon(process.env.DATABASE_URL!);
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
}
