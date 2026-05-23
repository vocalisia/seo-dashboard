/**
 * migrate-position-history.mjs
 *
 * Adds tracked_keywords.position_history JSONB column to store rolling 30-day
 * snapshots of current_position for drift detection. Format:
 *   [{ "date": "2026-05-23", "position": 7.2 }, ...]
 *
 * Run: node scripts/migrate-position-history.mjs
 * Idempotent: ADD COLUMN IF NOT EXISTS.
 */

import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnv(file) {
  try {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+?)\s*$/);
      if (m) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
      }
    }
  } catch (_e) { /* ok */ }
}
loadEnv('.env.production');
loadEnv('.env.local');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log('[migrate] adding tracked_keywords.position_history ...');
await sql`
  ALTER TABLE tracked_keywords
    ADD COLUMN IF NOT EXISTS position_history JSONB DEFAULT '[]'::jsonb
`;
await sql`
  CREATE INDEX IF NOT EXISTS idx_tracked_keywords_history
    ON tracked_keywords USING gin(position_history)
`;
console.log('[migrate] done.');

const sample = await sql`
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE position_history IS NOT NULL)::int AS with_col
  FROM tracked_keywords
`;
console.log('[migrate] tracked_keywords rows:', sample[0]);
