/**
 * Daily position drift watchdog — runs 06:00 UTC.
 *
 * Logic:
 * 1. Read all active tracked_keywords with their position_history.
 * 2. For each kw, append today's snapshot { date, position } to position_history.
 *    Prune entries older than 30 days. Persist.
 * 3. Compare today's current_position vs the snapshot from ~7 days ago.
 * 4. If drift > 5 positions (worse = larger number), flag as alert.
 * 5. Group alerts by site, send email digest via Resend.
 *
 * Idempotent: appending today's snapshot uses date dedupe (replace existing entry
 * for today). Safe to re-run same day.
 *
 * Auth: requireCronOrUser (Vercel cron secret OR dashboard user session).
 * Manual trigger: GET /api/cron/position-drift-watch with x-cron-secret header.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";
import { logError } from "@/lib/logger";
import { escapeHtml } from "@/lib/safe-output";

const DRIFT_THRESHOLD = 5; // positions worse to fire alert
const COMPARE_WINDOW_DAYS = 7;
const HISTORY_PRUNE_DAYS = 30;
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? "cohenrichard07@gmail.com";

interface HistoryEntry {
  date: string;
  position: number;
}

interface KeywordRow {
  id: number;
  keyword: string;
  market: string | null;
  current_position: number | null;
  site_id: number;
  site_name: string;
  site_url: string;
  position_history: HistoryEntry[] | null;
}

interface DriftAlert {
  site_id: number;
  site_name: string;
  site_url: string;
  keyword: string;
  market: string | null;
  position_now: number;
  position_then: number;
  drift: number;
  baseline_date: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function pruneHistory(history: HistoryEntry[]): HistoryEntry[] {
  const cutoff = daysAgoISO(HISTORY_PRUNE_DAYS);
  return history.filter((h) => h.date >= cutoff);
}

function appendTodaySnapshot(
  history: HistoryEntry[],
  position: number
): HistoryEntry[] {
  const today = todayISO();
  // Replace today's entry if it already exists (idempotent re-run)
  const filtered = history.filter((h) => h.date !== today);
  filtered.push({ date: today, position });
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Find the snapshot closest to `targetDaysAgo` days ago.
 * Returns null if history has nothing in that window.
 */
function findBaseline(
  history: HistoryEntry[],
  targetDaysAgo: number
): HistoryEntry | null {
  if (history.length === 0) return null;
  const targetDate = daysAgoISO(targetDaysAgo);
  // Pick the latest entry on or before targetDate
  const eligible = history.filter((h) => h.date <= targetDate);
  if (eligible.length === 0) return null;
  return eligible[eligible.length - 1];
}

function buildEmailHtml(alerts: DriftAlert[]): string {
  if (alerts.length === 0) {
    return `<h2>Position drift watchdog</h2><p>No drifts above ${DRIFT_THRESHOLD} positions detected over the last ${COMPARE_WINDOW_DAYS} days.</p>`;
  }

  // Group by site
  const bySite = new Map<number, DriftAlert[]>();
  for (const a of alerts) {
    const arr = bySite.get(a.site_id) ?? [];
    arr.push(a);
    bySite.set(a.site_id, arr);
  }

  let html = `<h2>Position drift watchdog — ${alerts.length} drift${alerts.length > 1 ? "s" : ""} detected</h2>`;
  html += `<p>Keywords that dropped more than <strong>${DRIFT_THRESHOLD} positions</strong> over the last ${COMPARE_WINDOW_DAYS} days.</p>`;

  for (const [, list] of bySite) {
    const first = list[0];
    list.sort((a, b) => b.drift - a.drift);
    html += `<h3>${escapeHtml(first.site_name)} <small>(${escapeHtml(first.site_url)})</small></h3>`;
    html += `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">`;
    html += `<tr><th>Keyword</th><th>Market</th><th>Was</th><th>Now</th><th>Drift</th><th>Baseline</th></tr>`;
    for (const a of list) {
      html += `<tr>`;
      html += `<td>${escapeHtml(a.keyword)}</td>`;
      html += `<td>${escapeHtml(a.market ?? "-")}</td>`;
      html += `<td>${a.position_then.toFixed(1)}</td>`;
      html += `<td><strong>${a.position_now.toFixed(1)}</strong></td>`;
      html += `<td style="color:#b91c1c">+${a.drift.toFixed(1)}</td>`;
      html += `<td>${a.baseline_date}</td>`;
      html += `</tr>`;
    }
    html += `</table>`;
  }

  html += `<p style="color:#888;font-size:12px;margin-top:24px">Daily watchdog — drift threshold ${DRIFT_THRESHOLD}, comparison window ${COMPARE_WINDOW_DAYS}d.</p>`;
  return html;
}

async function sendDigestEmail(alerts: DriftAlert[]): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return false;
  // Only send email if there are alerts (digest spam guard)
  if (alerts.length === 0) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SEO Dashboard <onboarding@resend.dev>",
        to: [ALERT_EMAIL],
        subject: `Position drift: ${alerts.length} keyword${alerts.length > 1 ? "s" : ""} dropped (>${DRIFT_THRESHOLD})`,
        html: buildEmailHtml(alerts),
      }),
    });
    return res.ok;
  } catch (err) {
    logError("cron.positionDriftWatch.resend", err, { alertCount: alerts.length });
    return false;
  }
}

async function runWatchdog() {
  const sql = getSQL();

  // Ensure column exists (idempotent — safety net if migration not run)
  await sql`
    ALTER TABLE tracked_keywords
      ADD COLUMN IF NOT EXISTS position_history JSONB DEFAULT '[]'::jsonb
  `;

  const rows = (await sql`
    SELECT k.id, k.keyword, k.market, k.current_position,
           k.site_id, s.name AS site_name, s.url AS site_url,
           COALESCE(k.position_history, '[]'::jsonb) AS position_history
    FROM tracked_keywords k
    JOIN sites s ON s.id = k.site_id
    WHERE k.is_active = TRUE
      AND s.is_active = TRUE
  `) as KeywordRow[];

  const alerts: DriftAlert[] = [];
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.current_position == null || row.current_position <= 0) {
      skipped++;
      continue;
    }

    const existing = Array.isArray(row.position_history)
      ? row.position_history
      : [];
    const pruned = pruneHistory(existing);

    // Find baseline ~7d ago BEFORE appending today's snapshot.
    const baseline = findBaseline(pruned, COMPARE_WINDOW_DAYS);
    const posNow = Number(row.current_position);

    if (baseline) {
      const posThen = Number(baseline.position);
      const drift = posNow - posThen;
      if (drift > DRIFT_THRESHOLD) {
        alerts.push({
          site_id: row.site_id,
          site_name: row.site_name,
          site_url: row.site_url,
          keyword: row.keyword,
          market: row.market,
          position_now: posNow,
          position_then: posThen,
          drift,
          baseline_date: baseline.date,
        });
      }
    }

    // Persist updated history (append today's snapshot, prune > 30d)
    const next = appendTodaySnapshot(pruned, posNow);
    await sql`
      UPDATE tracked_keywords
      SET position_history = ${JSON.stringify(next)}::jsonb
      WHERE id = ${row.id}
    `;
    updated++;
  }

  // Sort alerts by site then drift severity
  alerts.sort((a, b) => {
    if (a.site_id !== b.site_id) return a.site_id - b.site_id;
    return b.drift - a.drift;
  });

  const emailSent = await sendDigestEmail(alerts);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    threshold: DRIFT_THRESHOLD,
    window_days: COMPARE_WINDOW_DAYS,
    keywords_scanned: rows.length,
    keywords_updated: updated,
    keywords_skipped: skipped,
    alerts_count: alerts.length,
    email_sent: emailSent,
    alerts: alerts.slice(0, 50), // cap payload size
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await runWatchdog();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export const POST = GET;
