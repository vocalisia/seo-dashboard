#!/usr/bin/env node
/**
 * Purge les seo_alerts not_indexed obsoletes et re-genere a partir
 * de autopilot_runs.published_url (HEAD live).
 *
 * Usage: node scripts/refresh-indexation-alerts.mjs
 *
 * Charge DATABASE_URL depuis .env.local.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const envText = readFileSync(envPath, "utf-8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function head(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    return r.status;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Step 1: purging stale not_indexed alerts...");
  const purged = await sql`
    DELETE FROM seo_alerts
    WHERE alert_type = 'not_indexed'
    RETURNING id
  `;
  console.log(`  deleted ${purged.length} stale rows`);

  console.log("Step 2: scanning autopilot_runs.published_url...");
  const runs = await sql`
    SELECT id, site_id, keyword, published_url, created_at
    FROM autopilot_runs
    WHERE status = 'published'
      AND published_url IS NOT NULL
      AND created_at < NOW() - INTERVAL '48 hours'
      AND created_at >= NOW() - INTERVAL '60 days'
    ORDER BY created_at DESC
  `;
  console.log(`  ${runs.length} candidates`);

  let dead = 0;
  let alive = 0;
  const failures = [];

  // 6-way concurrent
  for (let i = 0; i < runs.length; i += 6) {
    const batch = runs.slice(i, i + 6);
    const codes = await Promise.all(batch.map((r) => head(r.published_url)));
    batch.forEach((r, j) => {
      const code = codes[j];
      if (code === 200) alive++;
      else {
        dead++;
        failures.push({ ...r, status_code: code });
      }
    });
  }
  console.log(`  alive=${alive} dead=${dead}`);

  console.log("Step 3: inserting fresh not_indexed alerts...");
  for (const f of failures) {
    await sql`
      INSERT INTO seo_alerts (site_id, alert_type, severity, keyword, message, data)
      VALUES (
        ${f.site_id},
        'not_indexed',
        'critical',
        ${f.keyword},
        ${`Article not accessible (HTTP ${f.status_code ?? "timeout"}) — ${f.published_url}`},
        ${JSON.stringify({ run_id: f.id, live_url: f.published_url, status_code: f.status_code })}
      )
    `;
  }
  console.log(`  inserted ${failures.length} fresh rows`);

  console.log("\nSummary:");
  console.log(`  purged_stale=${purged.length}`);
  console.log(`  scanned=${runs.length}`);
  console.log(`  alive=${alive}`);
  console.log(`  dead=${dead} (re-inserted as fresh alerts)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
