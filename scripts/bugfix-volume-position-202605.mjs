/**
 * bugfix-volume-position-202605.mjs
 *
 * Fix Bug A — Duplicate volume per (keyword, market) inconsistent across sites
 *   → Deduplicate via MAX(volume_market) over (LOWER(keyword), market) and
 *     write back to every row.
 *
 * Fix Bug B — current_position was AVG(position) weighted by impressions,
 *   showing inflated values when deep pages outranked the homepage in impression
 *   volume. Reset current_position = MIN(position) over the same country-filtered
 *   window the recalc script uses (28d).
 *
 * Always snapshots tracked_keywords first to _kw-verify/snapshot-bugfix-<ts>.json.
 *
 * Usage:
 *   node scripts/bugfix-volume-position-202605.mjs           # apply
 *   node scripts/bugfix-volume-position-202605.mjs --dry     # show samples only
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
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
const dry = process.argv.includes('--dry');

function siteCountryCode(url) {
  if (!url) return 'FRA';
  let host = String(url).toLowerCase().trim().replace(/^sc-domain:/, '');
  try { if (host.includes('://')) host = new URL(host).hostname; } catch (_e) {}
  host = host.replace(/^www\./, '').replace(/\/+$/, '');
  const tld = host.split('.').pop() || '';
  if (tld === 'ch') return 'CHE';
  if (tld === 'be') return 'BEL';
  if (tld === 'ca') return 'CAN';
  return 'FRA';
}

// 1) Snapshot
const ts = Date.now();
const snapDir = join(ROOT, '_kw-verify');
if (!existsSync(snapDir)) mkdirSync(snapDir, { recursive: true });
const snapPath = join(snapDir, `snapshot-bugfix-${ts}.json`);

const snapshot = await sql`
  SELECT id, site_id, keyword, market, volume_fr, volume_market,
         current_position, current_impressions, current_clicks, updated_at
  FROM tracked_keywords
  WHERE is_active = TRUE
  ORDER BY id
`;
writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));
console.log(`[snapshot] ${snapshot.length} rows → ${snapPath}`);

// ────────────────────────────────────────────────────────────────────────────
// Bug A — Volume dedup per (LOWER(keyword), market)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[Bug A] — Volume dedup');

// Sample BEFORE: keywords appearing on >=2 sites with diverging volumes
const dupRowsBefore = await sql`
  SELECT LOWER(keyword) AS k, market,
         COUNT(*) AS n_sites,
         array_agg(volume_market ORDER BY volume_market DESC NULLS LAST) AS vols,
         array_agg(site_id ORDER BY volume_market DESC NULLS LAST) AS site_ids,
         MAX(volume_market) AS max_vol,
         MIN(volume_market) AS min_vol
  FROM tracked_keywords
  WHERE is_active = TRUE
  GROUP BY LOWER(keyword), market
  HAVING COUNT(*) >= 2
     AND MAX(COALESCE(volume_market,0)) <> MIN(COALESCE(volume_market,0))
  ORDER BY MAX(volume_market) DESC NULLS LAST
  LIMIT 5
`;

console.log('\nSample BEFORE (top 5 diverging keywords across sites):');
console.log('keyword | market | n_sites | volumes per site | will become');
for (const r of dupRowsBefore) {
  console.log(`  "${r.k}" | ${r.market} | ${r.n_sites} | [${r.vols.join(',')}] → ${r.max_vol}`);
}

if (!dry) {
  // Apply dedup
  const dedupRes = await sql`
    WITH canonical AS (
      SELECT LOWER(keyword) AS k, market, MAX(volume_market) AS canonical_vol
      FROM tracked_keywords
      WHERE is_active = TRUE
      GROUP BY LOWER(keyword), market
    )
    UPDATE tracked_keywords tk
    SET volume_market = c.canonical_vol,
        volume_source = COALESCE(volume_source, '') || ' + canonical-dedup',
        updated_at    = NOW()
    FROM canonical c
    WHERE LOWER(tk.keyword) = c.k
      AND tk.market         = c.market
      AND tk.is_active      = TRUE
      AND tk.volume_market IS DISTINCT FROM c.canonical_vol
    RETURNING id
  `;
  console.log(`[Bug A] Updated ${dedupRes.length} rows (volume canonicalized)`);
}

// ────────────────────────────────────────────────────────────────────────────
// Bug B — current_position = best-page MIN (28d, country-filtered)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[Bug B] — Position fix (MIN over pages)');

const sites = await sql`SELECT id, url, name FROM sites WHERE is_active = TRUE ORDER BY id`;

const positionSamples = [];
let updatedPos = 0;
let nodataPos = 0;

for (const s of sites) {
  const cc = siteCountryCode(s.url);
  const kws = await sql`
    SELECT id, keyword, current_position, current_impressions
    FROM tracked_keywords
    WHERE site_id = ${s.id} AND is_active = TRUE
  `;
  for (const k of kws) {
    // For each (site, keyword): compute MIN(position) and AVG weighted (for sample log)
    const r = await sql`
      SELECT
        MIN(NULLIF(position, 0))                                                                AS best_pos,
        AVG(NULLIF(position, 0))                                                                AS avg_pos_raw,
        SUM(impressions * position)::float / NULLIF(SUM(impressions), 0)                        AS avg_pos_weighted,
        COALESCE(SUM(impressions), 0)                                                            AS impressions
      FROM search_console_data
      WHERE site_id = ${s.id}
        AND LOWER(query) = LOWER(${k.keyword})
        AND date >= CURRENT_DATE - INTERVAL '28 days'
        AND (country IS NULL OR country = '' OR country = ${cc})
        AND position BETWEEN 1 AND 200
    `;
    const row = r[0] || {};
    const bestPos = row.best_pos != null ? Number(row.best_pos) : null;
    const avgWeighted = row.avg_pos_weighted != null ? Number(row.avg_pos_weighted) : null;
    const imp = Number(row.impressions ?? 0);

    if (bestPos == null || imp <= 0) {
      nodataPos += 1;
      continue;
    }

    const oldPos = k.current_position != null ? Number(k.current_position) : null;
    const bestRounded = Number(bestPos.toFixed(2));

    // Capture samples where best vs avg-weighted diverge significantly
    if (positionSamples.length < 5 && avgWeighted != null && Math.abs(avgWeighted - bestPos) > 5) {
      positionSamples.push({
        site: s.url,
        keyword: k.keyword,
        avg_pos_weighted: Number(avgWeighted.toFixed(2)),
        best_pos: bestRounded,
        impressions: imp,
        old_stored: oldPos,
      });
    }

    if (!dry && (oldPos == null || Math.abs(oldPos - bestPos) > 0.05)) {
      await sql`
        UPDATE tracked_keywords
        SET current_position = ${bestRounded},
            updated_at = NOW()
        WHERE id = ${k.id}
      `;
      updatedPos += 1;
    }
  }
}
console.log(`[Bug B] Updated ${updatedPos} rows, ${nodataPos} skipped (no data)`);

console.log('\nSample BEFORE/AFTER (top 5 with significant divergence):');
console.log('site | keyword | avg_weighted (old) | best (new) | impressions');
for (const p of positionSamples) {
  console.log(`  ${p.site} | "${p.keyword}" | ${p.avg_pos_weighted} | ${p.best_pos} | ${p.impressions}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Verify: same keyword same volume across sites now
// ────────────────────────────────────────────────────────────────────────────
const dupCheck = await sql`
  SELECT LOWER(keyword) AS k, market,
         COUNT(DISTINCT volume_market) AS distinct_vols
  FROM tracked_keywords
  WHERE is_active = TRUE
  GROUP BY LOWER(keyword), market
  HAVING COUNT(DISTINCT volume_market) > 1
`;
console.log(`\n[verify] ${dupCheck.length} (keyword,market) groups still have >1 distinct volume`);

// Write diff samples for the response
const reportPath = join(snapDir, `bugfix-report-${ts}.json`);
writeFileSync(reportPath, JSON.stringify({
  ts,
  snapshot: snapPath,
  bug_a: {
    sample_before: dupRowsBefore,
    rows_changed: dry ? 'dry-run' : 'see logs',
    remaining_inconsistencies: dupCheck.length,
  },
  bug_b: {
    sample_diffs: positionSamples,
    rows_changed: updatedPos,
    rows_no_data: nodataPos,
  },
}, null, 2));
console.log(`\n[report] → ${reportPath}`);
console.log(dry ? '\n[DRY RUN] no UPDATE was executed' : '\n[DONE] bugfix applied');
