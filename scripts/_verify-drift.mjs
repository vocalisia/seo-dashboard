/**
 * _verify-drift.mjs - Manual verification of position drift watchdog logic.
 * Mirrors the cron route. Use to confirm DB integration locally.
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
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
      }
    }
  } catch {}
}
loadEnv('.env.production');
loadEnv('.env.local');

const sql = neon(process.env.DATABASE_URL);

const DRIFT_THRESHOLD = 5;
const COMPARE_WINDOW_DAYS = 7;
const HISTORY_PRUNE_DAYS = 30;

function todayISO() { return new Date().toISOString().slice(0,10); }
function daysAgoISO(d) { const x = new Date(); x.setUTCDate(x.getUTCDate()-d); return x.toISOString().slice(0,10); }
function pruneHistory(h) { const c = daysAgoISO(HISTORY_PRUNE_DAYS); return h.filter(e => e.date >= c); }
function appendToday(h, p) { const t = todayISO(); return [...h.filter(e=>e.date!==t), {date:t, position:p}].sort((a,b)=>a.date.localeCompare(b.date)); }
function findBaseline(h, td) { const t = daysAgoISO(td); const e = h.filter(x=>x.date<=t); return e.length?e[e.length-1]:null; }

const rows = await sql`
  SELECT k.id, k.keyword, k.market, k.current_position,
         k.site_id, s.name AS site_name, s.url AS site_url,
         COALESCE(k.position_history, '[]'::jsonb) AS position_history
  FROM tracked_keywords k
  JOIN sites s ON s.id = k.site_id
  WHERE k.is_active = TRUE AND s.is_active = TRUE
`;

const alerts = [];
let updated = 0, skipped = 0;

for (const row of rows) {
  if (row.current_position == null || row.current_position <= 0) { skipped++; continue; }
  const existing = Array.isArray(row.position_history) ? row.position_history : [];
  const pruned = pruneHistory(existing);
  const baseline = findBaseline(pruned, COMPARE_WINDOW_DAYS);
  const posNow = Number(row.current_position);
  if (baseline) {
    const drift = posNow - Number(baseline.position);
    if (drift > DRIFT_THRESHOLD) {
      alerts.push({ site: row.site_name, kw: row.keyword, was: Number(baseline.position), now: posNow, drift, baseline_date: baseline.date });
    }
  }
  const next = appendToday(pruned, posNow);
  await sql`UPDATE tracked_keywords SET position_history = ${JSON.stringify(next)}::jsonb WHERE id = ${row.id}`;
  updated++;
}

console.log(JSON.stringify({
  success: true,
  timestamp: new Date().toISOString(),
  threshold: DRIFT_THRESHOLD,
  window_days: COMPARE_WINDOW_DAYS,
  keywords_scanned: rows.length,
  keywords_updated: updated,
  keywords_skipped: skipped,
  alerts_count: alerts.length,
  alerts: alerts.slice(0, 20),
}, null, 2));
