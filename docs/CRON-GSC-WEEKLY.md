# GSC Weekly Cron — Deploy & Ops

## What it does

Every Monday 8:00 UTC (9h Paris winter / 10h summer):

1. Lists + resubmits broken sitemaps for all 12 Vault 369 sites
2. Fetches top-20 queries + impression/click totals (last 7 days) per site
3. Saves snapshot to `gsc_snapshots` Postgres table (Neon)
4. Compares vs previous week — alerts if impressions drop > 30% or position drifts > 5 places on top-5 queries
5. Sends markdown email via Brevo (fallback: Resend)
6. Pings IndexNow / Bing with homepage URLs

## Required Vercel env vars

| Var | Description |
|-----|-------------|
| `GOOGLE_CREDENTIALS` | Full Service Account JSON, stringified (`JSON.stringify(sa.json)`) |
| `DATABASE_URL` | Neon Postgres connection string |
| `CRON_SECRET` | Random 32+ char secret (`openssl rand -hex 32`) |
| `BREVO_API_KEY` | Brevo SMTP API key (preferred email provider) |
| `RESEND_API_KEY` | Resend API key (fallback if Brevo absent) |
| `INDEXNOW_KEY` | Default: `551683f27598a229d3e9dc91cb786208` |
| `ALERT_EMAIL` | Default: `cohenrichard07@gmail.com` |

## Deploy

```bash
# Set env vars in Vercel dashboard or CLI
vercel env add CRON_SECRET production
vercel env add BREVO_API_KEY production

# Deploy (git push triggers Vercel if deploymentEnabled — otherwise manual)
vercel deploy --prod
```

Vercel auto-registers the cron from `vercel.json`:
```json
{ "path": "/api/cron/gsc-weekly", "schedule": "0 8 * * 1" }
```

## Test locally

```bash
# 1. Start dev server
npm run dev

# 2. Trigger route (CRON_SECRET from .env.local)
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/gsc-weekly
```

Expected response:
```json
{
  "success": true,
  "sites_processed": 12,
  "drops_detected": 0,
  "sitemaps_resubmitted": 0,
  "emails_sent": 1,
  "snapshot_date": "2026-04-28"
}
```

## Add a site

Open `src/app/api/cron/gsc-weekly/route.ts` and append to `VAULT_SITES`:

```ts
const VAULT_SITES = [
  ...
  "sc-domain:your-new-site.com",
] as const;
```

## Email example

**Subject:** `GSC Weekly: 2 drops detected`

```
# GSC Weekly Report

| Site                    | Impression drop | Query drifts (pos)                     |
|-------------------------|----------------|----------------------------------------|
| sc-domain:vocalis.pro   | 42.3%          | agence vocalis (3.1 → 9.4)            |
| sc-domain:tesla-mag.ch  | 31.0%          | tesla model 3 prix (5.0 → 11.2)       |
```

When all sites stable:

**Subject:** `GSC Weekly: All stable`

## DB schema (auto-created on first run)

```sql
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
);
CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_site_date
  ON gsc_snapshots(site, snapshot_date DESC);
```
