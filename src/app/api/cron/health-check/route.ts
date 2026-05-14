/**
 * Daily site health check — scanne tous les sites actifs et stocke un rapport.
 * Détecte automatiquement les régressions GA4 (consent mode, doublons), SEO
 * (canonical, og:image, H1, schema), accessibilité (html lang).
 *
 * Cron : exécuté chaque jour à 06h UTC via vercel.json.
 * Email alert si > 0 issue CRITICAL apparue depuis le dernier run.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";
import { checkSiteHealth, type HealthReport } from "@/lib/site-health-check";
import { logAutopilot } from "@/lib/autopilot-log";

interface SiteRow {
  id: number;
  name: string;
  url: string;
  is_active: boolean;
}

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;
  return runHealthCheck();
}

export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;
  return runHealthCheck();
}

async function runHealthCheck() {
  const sql = getSQL();

  // Garantit l'existence de la table (idempotent)
  await sql`
    CREATE TABLE IF NOT EXISTS site_health_checks (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      http_status INTEGER,
      ga4_id VARCHAR(50),
      has_consent_mode BOOLEAN,
      has_schema_jsonld BOOLEAN,
      critical_count INTEGER DEFAULT 0,
      high_count INTEGER DEFAULT 0,
      medium_count INTEGER DEFAULT 0,
      low_count INTEGER DEFAULT 0,
      issues JSONB
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_site_health_site_id ON site_health_checks(site_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_site_health_scanned_at ON site_health_checks(scanned_at DESC)`;

  const sites = (await sql`
    SELECT id, name, url, is_active FROM sites WHERE is_active = TRUE ORDER BY id
  `) as SiteRow[];

  logAutopilot("health_check_start", { count: sites.length });

  const reports: Array<{ site: SiteRow; report: HealthReport }> = [];

  // Concurrent scan, 4-way
  for (let i = 0; i < sites.length; i += 4) {
    const batch = sites.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (s) => ({ site: s, report: await checkSiteHealth(s.url) }))
    );
    reports.push(...results);
  }

  // Persist + count
  for (const { site, report } of reports) {
    const critical = report.issues.filter((i) => i.severity === "critical").length;
    const high = report.issues.filter((i) => i.severity === "high").length;
    const medium = report.issues.filter((i) => i.severity === "medium").length;
    const low = report.issues.filter((i) => i.severity === "low").length;

    await sql`
      INSERT INTO site_health_checks
        (site_id, scanned_at, http_status, ga4_id, has_consent_mode, has_schema_jsonld,
         critical_count, high_count, medium_count, low_count, issues)
      VALUES
        (${site.id}, ${report.scanned_at}, ${report.http_status}, ${report.ga4_id},
         ${report.has_consent_mode}, ${report.has_schema_jsonld},
         ${critical}, ${high}, ${medium}, ${low}, ${JSON.stringify(report.issues)})
    `;
  }

  // Build summary
  const summary = reports.map(({ site, report }) => ({
    site_id: site.id,
    name: site.name,
    url: site.url,
    critical: report.issues.filter((i) => i.severity === "critical").length,
    high: report.issues.filter((i) => i.severity === "high").length,
    medium: report.issues.filter((i) => i.severity === "medium").length,
    low: report.issues.filter((i) => i.severity === "low").length,
    fetched: report.fetched,
  }));

  const totalCritical = summary.reduce((a, s) => a + s.critical, 0);
  const totalHigh = summary.reduce((a, s) => a + s.high, 0);

  logAutopilot("health_check_done", {
    sites: sites.length,
    critical: totalCritical,
    high: totalHigh,
  });

  // Email alert si critical ou high détecté
  const resendKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;
  if ((totalCritical > 0 || totalHigh > 0) && resendKey && alertEmail) {
    const offenders = reports
      .filter(
        ({ report }) =>
          report.issues.some(
            (i) => i.severity === "critical" || i.severity === "high"
          )
      )
      .map(({ site, report }) => {
        const issues = report.issues
          .filter((i) => i.severity === "critical" || i.severity === "high")
          .map((i) => `<li>[${i.severity}] ${i.code}: ${i.message}</li>`)
          .join("");
        return `<h4>${site.name} — ${site.url}</h4><ul>${issues}</ul>`;
      })
      .join("");

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "SEO Dashboard <onboarding@resend.dev>",
          to: [alertEmail],
          subject: `🩺 Health Check — ${totalCritical} critical, ${totalHigh} high`,
          html:
            `<h2>Site Health Check — ${new Date().toLocaleString("fr-FR")}</h2>` +
            `<p>${totalCritical} CRITICAL + ${totalHigh} HIGH issues détectés sur ${reports.length} sites.</p>` +
            offenders +
            `<p style="color:#888;font-size:12px">Auto-scan quotidien — désactiver le cron pour stopper.</p>`,
        }),
      });
    } catch (err) {
      console.error("health-check: email alert failed:", err);
    }
  }

  return NextResponse.json({
    success: true,
    sites: reports.length,
    critical: totalCritical,
    high: totalHigh,
    summary,
  });
}
