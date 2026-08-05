import type { getSQL } from "@/lib/db";

type SQLClient = ReturnType<typeof getSQL>;

export async function ensureCompetitorResearchSchema(sql: SQLClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS competitor_research (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      competitor_domain VARCHAR(500),
      competitor_description TEXT,
      keyword VARCHAR(500),
      estimated_volume INTEGER,
      competitor_position DECIMAL(6,2),
      difficulty VARCHAR(20),
      intent VARCHAR(30),
      source_url TEXT,
      source_id VARCHAR(40),
      evidence_score DECIMAL(6,2),
      source_count INTEGER,
      cluster_name VARCHAR(500),
      engine_version VARCHAR(40),
      source_kind VARCHAR(40),
      researched_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE competitor_research
      ADD COLUMN IF NOT EXISTS source_url TEXT,
      ADD COLUMN IF NOT EXISTS source_id VARCHAR(40),
      ADD COLUMN IF NOT EXISTS evidence_score DECIMAL(6,2),
      ADD COLUMN IF NOT EXISTS source_count INTEGER,
      ADD COLUMN IF NOT EXISTS cluster_name VARCHAR(500),
      ADD COLUMN IF NOT EXISTS engine_version VARCHAR(40),
      ADD COLUMN IF NOT EXISTS source_kind VARCHAR(40)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_research_natural_key
      ON competitor_research(site_id, LOWER(competitor_domain), LOWER(keyword))
  `;
}
