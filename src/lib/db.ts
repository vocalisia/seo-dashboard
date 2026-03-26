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
}
