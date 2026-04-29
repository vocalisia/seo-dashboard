import { NextResponse } from "next/server";
import { google } from "googleapis";
import { requireCronSecret } from "@/lib/cron-auth";
import { getGoogleAuthWithWriteScope } from "@/lib/google-auth";
import { getSQL } from "@/lib/db";

// ── Vault 369 LTD — 12 monitored sites ──────────────────────────────────────
const VAULT_SITES = [
  "sc-domain:seo-true.com",
  "sc-domain:agentic-whatsup.com",
  "sc-domain:vocalis.pro",
  "sc-domain:master-seller.fr",
  "sc-domain:trustly-ai.com",
  "sc-domain:iapmesuisse.ch",
  "sc-domain:tesla-mag.ch",
  "sc-domain:cbdeuropa.com",
  "sc-domain:lead-gene.com",
  "sc-domain:agents-ia.pro",
  "sc-domain:vocalis-ai.org",
  "sc-domain:ai-due.com",
] as const;

const INDEXNOW_KEY =
  process.env.INDEXNOW_KEY ?? "551683f27598a229d3e9dc91cb786208";
const ALERT_EMAIL =
  process.env.ALERT_EMAIL ?? "cohenrichard07@gmail.com";

// ── Types ────────────────────────────────────────────────────────────────────

interface TopQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface SitemapStatus {
  sitemap: string;
  isPending: boolean;
  isBroken: boolean;
  errors: number;
  warnings: number;
  resubmitted: boolean;
}

interface SiteSnapshot {
  site: string;
  impressions: number;
  clicks: number;
  top_queries: TopQuery[];
  sitemap_status: SitemapStatus[];
}

interface SiteDrop {
  site: string;
  impressionDropPct: number;
  queryDrifts: { query: string; prevPos: number; currPos: number; drift: number }[];
}

interface PrevSnapshot {
  impressions: number;
  clicks: number;
  top_queries: TopQuery[];
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function ensureGscSnapshotsTable(): Promise<void> {
  const sql = getSQL();
  await sql`
    CREATE TABLE IF NOT EXISTS gsc_snapshots (
      id SERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      impressions INTEGER,
      clicks INTEGER,
      top_queries JSONB,
      sitemap_status JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(site, snapshot_date)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_site_date
      ON gsc_snapshots(site, snapshot_date DESC)
  `;
}

async function saveSnapshot(snap: SiteSnapshot, date: string): Promise<void> {
  const sql = getSQL();
  await sql`
    INSERT INTO gsc_snapshots (site, snapshot_date, impressions, clicks, top_queries, sitemap_status)
    VALUES (
      ${snap.site},
      ${date}::date,
      ${snap.impressions},
      ${snap.clicks},
      ${JSON.stringify(snap.top_queries)}::jsonb,
      ${JSON.stringify(snap.sitemap_status)}::jsonb
    )
    ON CONFLICT (site, snapshot_date) DO UPDATE SET
      impressions    = EXCLUDED.impressions,
      clicks         = EXCLUDED.clicks,
      top_queries    = EXCLUDED.top_queries,
      sitemap_status = EXCLUDED.sitemap_status
  `;
}

async function getPreviousSnapshot(
  site: string,
  beforeDate: string
): Promise<PrevSnapshot | null> {
  const sql = getSQL();
  const rows = await sql`
    SELECT impressions, clicks, top_queries
    FROM gsc_snapshots
    WHERE site = ${site}
      AND snapshot_date < ${beforeDate}::date
    ORDER BY snapshot_date DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0] as { impressions: number; clicks: number; top_queries: TopQuery[] };
  return {
    impressions: row.impressions,
    clicks: row.clicks,
    top_queries: row.top_queries ?? [],
  };
}

// ── GSC helpers ──────────────────────────────────────────────────────────────

async function processSite(
  site: string,
  gscClient: ReturnType<typeof google.searchconsole>
): Promise<SiteSnapshot> {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // 1. Sitemaps — list + resubmit broken ones
  let sitemapStatus: SitemapStatus[] = [];
  let resubmittedCount = 0;

  try {
    const sitemapRes = await gscClient.sitemaps.list({ siteUrl: site });
    const sitemaps = sitemapRes.data.sitemap ?? [];

    sitemapStatus = await Promise.all(
      sitemaps.map(async (sm) => {
        const smUrl = sm.path ?? "";
        const errors = Number(sm.errors ?? 0);
        const warnings = Number(sm.warnings ?? 0);
        const isBroken = errors > 0;
        let resubmitted = false;

        if (isBroken) {
          try {
            await gscClient.sitemaps.submit({ siteUrl: site, feedpath: smUrl });
            resubmitted = true;
            resubmittedCount++;
          } catch {
            // Non-fatal — log only
            console.error(`[gsc-weekly] sitemap resubmit failed: ${smUrl}`);
          }
        }

        return {
          sitemap: smUrl,
          isPending: sm.isPending ?? false,
          isBroken,
          errors,
          warnings,
          resubmitted,
        };
      })
    );
  } catch {
    console.error(`[gsc-weekly] sitemaps.list failed for ${site}`);
  }

  // 2. Top queries (last 7 days)
  let topQueries: TopQuery[] = [];
  let impressions = 0;
  let clicks = 0;

  try {
    const queryRes = await gscClient.searchanalytics.query({
      siteUrl: site,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: 20,
      },
    });

    const rows = queryRes.data.rows ?? [];
    topQueries = rows.map((r) => ({
      query: (r.keys ?? [])[0] ?? "",
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      position: r.position ?? 0,
    }));

    // 3. Totals (aggregate call)
    const totalRes = await gscClient.searchanalytics.query({
      siteUrl: site,
      requestBody: { startDate, endDate, rowLimit: 1 },
    });
    const agg = totalRes.data.rows ?? [];
    if (agg.length > 0) {
      impressions = agg[0].impressions ?? 0;
      clicks = agg[0].clicks ?? 0;
    }
  } catch {
    console.error(`[gsc-weekly] searchanalytics.query failed for ${site}`);
  }

  return { site, impressions, clicks, top_queries: topQueries, sitemap_status: sitemapStatus };
}

// ── IndexNow ─────────────────────────────────────────────────────────────────

async function pingIndexNow(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const body = {
    host: new URL(urls[0]).hostname,
    key: INDEXNOW_KEY,
    keyLocation: `https://${new URL(urls[0]).hostname}/${INDEXNOW_KEY}.txt`,
    urlList: urls.slice(0, 100),
  };
  try {
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch {
    console.error("[gsc-weekly] IndexNow ping failed for", urls[0]);
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

function buildEmailMarkdown(drops: SiteDrop[]): string {
  const hasDrops = drops.length > 0;
  const subject = hasDrops
    ? `GSC Weekly: ${drops.length} drop${drops.length > 1 ? "s" : ""} detected`
    : "GSC Weekly: All stable";

  const rows = drops.map((d) => {
    const drifts = d.queryDrifts
      .map((q) => `${q.query} (${q.prevPos.toFixed(1)} → ${q.currPos.toFixed(1)})`)
      .join(", ");
    return `| ${d.site} | ${d.impressionDropPct.toFixed(1)}% | ${drifts || "—"} |`;
  });

  const table =
    rows.length > 0
      ? [
          "| Site | Impression drop | Query drifts (pos) |",
          "|------|----------------|-------------------|",
          ...rows,
        ].join("\n")
      : "_No significant drops detected._";

  return `Subject: ${subject}\n\n# GSC Weekly Report\n\n${table}`;
}

async function sendEmailBrevo(
  subject: string,
  htmlBody: string
): Promise<boolean> {
  const key = process.env.BREVO_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "SEO Dashboard", email: ALERT_EMAIL },
      to: [{ email: ALERT_EMAIL }],
      subject,
      htmlContent: htmlBody,
    }),
  });
  return res.ok;
}

async function sendEmailResend(
  subject: string,
  htmlBody: string
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `SEO Dashboard <${ALERT_EMAIL}>`,
      to: [ALERT_EMAIL],
      subject,
      html: htmlBody,
    }),
  });
  return res.ok;
}

function markdownToHtml(md: string): string {
  // Simple conversion: tables + headings + paragraphs
  return md
    .replace(/^Subject: .+\n\n/m, "")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\|(.+)\|/g, (line) => {
      if (line.includes("---")) return "";
      const cells = line
        .split("|")
        .filter(Boolean)
        .map((c) => `<td>${c.trim()}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/(<tr>[^<]*(?:<td>[^<]*<\/td>)+<\/tr>)/g, (block) => `<table border="1">${block}</table>`)
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

async function sendAlertEmail(drops: SiteDrop[]): Promise<boolean> {
  const md = buildEmailMarkdown(drops);
  const subjectLine = md.split("\n")[0].replace("Subject: ", "");
  const html = markdownToHtml(md);

  const sentBrevo = await sendEmailBrevo(subjectLine, html);
  if (sentBrevo) return true;

  const sentResend = await sendEmailResend(subjectLine, html);
  if (sentResend) return true;

  console.log("[gsc-weekly] No email provider — logging report:\n", md);
  return false;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  await ensureGscSnapshotsTable();

  const auth = getGoogleAuthWithWriteScope();
  const gscClient = google.searchconsole({ version: "v1", auth: auth as never });

  const today = new Date().toISOString().slice(0, 10);

  // Process all sites in parallel
  const snapshots = await Promise.allSettled(
    VAULT_SITES.map((site) => processSite(site, gscClient))
  );

  let sitesProcessed = 0;
  let sitemapsResubmitted = 0;
  const drops: SiteDrop[] = [];
  const indexNowUrls: string[] = [];

  for (const result of snapshots) {
    if (result.status === "rejected") continue;
    const snap = result.value;
    sitesProcessed++;

    // Resubmitted count
    for (const sm of snap.sitemap_status) {
      if (sm.resubmitted) sitemapsResubmitted++;
    }

    // Collect IndexNow URLs (homepage + top pages from queries)
    const domainMatch = snap.site.match(/^sc-domain:(.+)$/);
    if (domainMatch) {
      const domain = domainMatch[1];
      indexNowUrls.push(`https://${domain}/`);
    }

    // Save snapshot
    try {
      await saveSnapshot(snap, today);
    } catch {
      console.error(`[gsc-weekly] saveSnapshot failed for ${snap.site}`);
    }

    // Compare vs previous week
    try {
      const prev = await getPreviousSnapshot(snap.site, today);
      if (prev && prev.impressions > 0) {
        const impressionDropPct =
          ((prev.impressions - snap.impressions) / prev.impressions) * 100;

        const queryDrifts: SiteDrop["queryDrifts"] = [];
        for (const currQ of snap.top_queries.slice(0, 5)) {
          const prevQ = prev.top_queries.find((q) => q.query === currQ.query);
          if (prevQ) {
            const drift = currQ.position - prevQ.position;
            if (drift > 5) {
              queryDrifts.push({
                query: currQ.query,
                prevPos: prevQ.position,
                currPos: currQ.position,
                drift,
              });
            }
          }
        }

        if (impressionDropPct > 30 || queryDrifts.length > 0) {
          drops.push({ site: snap.site, impressionDropPct, queryDrifts });
        }
      }
    } catch {
      console.error(`[gsc-weekly] comparison failed for ${snap.site}`);
    }
  }

  // IndexNow ping per domain (group by host)
  const byHost: Record<string, string[]> = {};
  for (const url of indexNowUrls) {
    try {
      const host = new URL(url).hostname;
      if (!byHost[host]) byHost[host] = [];
      byHost[host].push(url);
    } catch {
      // skip invalid URL
    }
  }
  await Promise.allSettled(
    Object.values(byHost).map((urls) => pingIndexNow(urls))
  );

  // Send email if drops or always (weekly digest)
  let emailsSent = 0;
  const sent = await sendAlertEmail(drops);
  if (sent) emailsSent++;

  return NextResponse.json({
    success: true,
    sites_processed: sitesProcessed,
    drops_detected: drops.length,
    sitemaps_resubmitted: sitemapsResubmitted,
    emails_sent: emailsSent,
    snapshot_date: today,
  });
}
