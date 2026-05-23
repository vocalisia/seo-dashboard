# Dashboard Guide (Internal)

Internal reference for the SEO dashboard. Not public marketing. Read this before
filing a "data looks wrong" issue — most surprises are documented here.

---

## 1. Position semantics: query-level vs page-level

The dashboard reads from two GSC tables that look similar but answer different questions.

| Table | Dimensions | Answers |
|------|------------|---------|
| `search_console_data` | site, date, query, **page**, country, device | "Which page ranks for this query?" |
| `search_console_query_data` | site, date, query, country, device (no page) | "What position does Google show for this query?" |

The GSC UI displays **query-level** positions (the second table). Page-level
positions over-aggregate: when a query ranks differently on multiple pages of
the same site, `AVG(position)` or even `SUM(impressions*position)/SUM(impressions)`
across pages skews toward whichever deep page got impressions. This is why
"position for keyword X on site Y" in the dashboard is **always** read from
`search_console_query_data` (since C1 refactor).

### When each table is read

- **Position-of-keyword** → query-level (sites, overview summary, keywords-pro,
  tracked_keywords.current_position)
- **Which page ranks** → page-level (cannibalization, striking-distance,
  competitors gap-by-page, search-console `type=pages`)
- **Clicks / impressions totals** → either (they're identical)

If a query-level row is missing for a site (early days of sync), the code
falls back to page-level so we never show 0.

---

## 2. The "Mots clés (3j)" card (lag-aware window)

GSC finalises data with a 2-3 day lag. The card labelled "Mots clés (3j)"
shows a window of **today - 5 to today - 3 days**, i.e. three full days
of finalised data, ending three days ago.

- It is normal to see "0 clicks" on day-1 or day-2. That is the lag, not
  a broken sync.
- The constant lives in `src/lib/gsc-window.ts` (`GSC_LAG_DAYS`).
- Bumping the window forward to "today" creates phantom drops that
  resolve themselves 48h later — do not change this default.

---

## 3. Country filter (TLD-first)

Each site has a primary country derived from its TLD:

- `.fr` → FRA, `.ch` → CHE, `.be` → BEL, `.ca` → CAN, `.de` → DEU, etc.
- Fallback for `.com` / generic TLDs: configured per site in `siteCountryCode()`.

What the filter does in SQL:

```sql
AND (country IS NULL OR country = '' OR country = ANY(${wanted}))
```

We **include rows with NULL/empty country** as a safety net (some legacy syncs
landed without a country dim). This means: numbers are filtered when GSC
provided a country, and not filtered when it didn't. It is not a bug —
removing the NULL clause drops 20–40% of clicks on older sites.

### Language override

Adding `?language=fr` to API calls expands the country list to all FR-speaking
markets (FRA, BEL, CHE, LUX, MCO, CAN). Similar for `en`, `de`, `es`, `it`,
`nl`, `pt`. Default is the site's TLD country only.

---

## 4. Keyword volume = canonical per (keyword, market)

Volumes (`tracked_keywords.volume_fr`, `tracked_keywords.volume_market`) are
**not per site**. They represent monthly search volume for that
`(keyword, market)` pair as reported by our SEO data provider. Two sites
tracking the same FR keyword see the **same** `volume_fr` — by design, because
that's what Google reports for the FR market.

If a row shows volume 0 for a known popular keyword: the market column on
`tracked_keywords` is probably missing or stale. Run
`scripts/recalc-tracked-volumes.mjs` to refresh.

---

## 5. Where the data comes from

- **GSC API** via service account at `Downloads/gsc-service-account.json.json`
  (env: `GOOGLE_SERVICE_ACCOUNT_KEY`).
- **GA4 API** via the same service account (sites need GA4 property ID in
  `sites.ga_property_id`).
- Sync horizon: 28 days by default (`/api/sync?days=28`). Weekly cron does 90d
  backfill on Mondays.

Service account is `siteOwner` on 17 GSC properties — sufficient for full
URL Inspection + sitemap submit on all 15 tracked domains.

---

## 6. Adding a new tracked keyword (UI flow)

1. Open `/tracked-keywords` page.
2. Pick the site from the dropdown.
3. Type the keyword, market (ISO-2 country code), optional target URL.
4. The row appears immediately with `current_position = NULL`. The next
   GSC daily sync (07:00 UTC) backfills `current_position`,
   `current_clicks`, `current_impressions` from `search_console_query_data`.
5. Volumes auto-populate from the SEO provider on next
   `recalc-tracked-volumes.mjs` run (manual or weekly cron).

To bulk-import keywords, use `scripts/import-keywords.mjs` (CSV format:
`site_id,keyword,market,target_url`).

---

## 7. Common false alarms

### "0 clicks" overnight

- **Most likely cause**: GSC lag (see section 2).
- **Real bug**: only if you see 0 clicks for >5 consecutive days on a site
  that previously had traffic. Check `/api/cron/health-check` log first.

### "Position jumped from 7 to 32 in one day"

- **Most likely cause**: page split — the query started ranking on a second
  page of the same site, pulling the page-level average down. The
  **query-level** position from `search_console_query_data` will still show
  the real position. Confirm via GSC UI Search Performance.
- **Real bug**: only if both query-level AND GSC UI agree on the drop. Then
  the watchdog cron will fire (see section 8).

### "Volume dropped from 12000 to 0"

- **Most likely cause**: `tracked_keywords.market` is NULL or wrong. The
  recalc script can't find the right volume row.
- **Fix**: set `market = 'FR'` (or correct ISO-2) on the row, re-run
  `scripts/recalc-tracked-volumes.mjs`.

### "CTR for keyword X dropped 80%"

- See `/api/ctr-anomaly` — the dashboard already flags this. A 80% drop with
  stable position usually means SERP feature competition (PAA, AI overview).
  The CTR anomaly card explains the breakdown.

---

## 8. Position drift watchdog

Cron: `/api/cron/position-drift-watch`, runs daily 06:00 UTC.

What it does:

1. For every active `tracked_keyword`, snapshot today's `current_position`
   into `tracked_keywords.position_history` (JSONB array, rolling 30d window).
2. Find the snapshot from ~7 days ago.
3. If position got worse by more than 5 positions, raise an alert.
4. Group alerts by site, email digest via Resend (`RESEND_API_KEY`,
   `ALERT_EMAIL` env vars). No email when there are no alerts.

Manual trigger:

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  https://seo-dashboard.vercel.app/api/cron/position-drift-watch
```

Returns JSON with `alerts_count`, `keywords_scanned`, `email_sent`, and the
top 50 alerts. Safe to re-run the same day — today's snapshot is replaced,
not appended twice.

Tuning:

- `DRIFT_THRESHOLD` (default 5) — minimum positions of worsening to alert.
- `COMPARE_WINDOW_DAYS` (default 7) — how far back to compare.
- `HISTORY_PRUNE_DAYS` (default 30) — how long to keep snapshots per keyword.

All three live at the top of `src/app/api/cron/position-drift-watch/route.ts`.

---

## 9. Auto-deploy

Push to `master` triggers Vercel build automatically. `vercel.json` no longer
has `deploymentEnabled: false`. Standard build machine only — never Turbo
(9× more expensive).

For projects that need manual deploy (only `autoseo` and `trust-ai-blog` in
the wider portfolio), use `vercel --prod` after push. Not applicable to
seo-dashboard.

---

## 10. Database tables quick reference

| Table | Rows when healthy | Purpose |
|------|-------------------|---------|
| `sites` | 22 active | Tracked properties (URL, GA4 ID, GSC property, country) |
| `search_console_data` | hundreds of millions | Page-level GSC (query × page × country × date) |
| `search_console_query_data` | tens of millions | Query-level GSC (query × country × date, no page) |
| `analytics_daily` | ~22 × 365 = 8k/yr | Daily GA4 aggregates per site |
| `tracked_keywords` | 219 | User-curated keywords with volumes + current position |
| `gsc_snapshots` | weekly × 12 = ~50/yr | Weekly impressions / queries snapshot per site |
| `site_health_checks` | daily × 22 = ~8k/yr | Daily HTML / GA4 / schema / consent checks |
| `autopilot_runs` | per article | Articles generated by autopilot weekly cron |
| `market_opportunities` | unbounded | Opportunity engine results, pending review |

Cleanup scripts in `scripts/` for stale URLs, dedupe, and re-fill.

---

## 11. Cron schedule (UTC)

| Time | Cron | Purpose |
|------|------|---------|
| 06:00 | health-check | HTML / GA4 / consent audit, alerts via Resend |
| 06:00 | position-drift-watch | Snapshot + drift alert (this doc, section 8) |
| 07:00 | gsc-daily | Light 7d refresh of GSC tables |
| 07:30 | alerts-daily | Position drops + indexing failures |
| 08:00 Mon | gsc-weekly | Full 90d backfill + IndexNow ping + email digest |
| 09:00 Mon | serp-track-weekly | Top 10 SERP snapshots |
| 09:00 Mon | autopilot-weekly | Auto-generate one article per active site |

All crons are authenticated via `requireCronOrUser` (CRON_SECRET header or
user session). They're also reachable from the dashboard UI via the
"Run now" buttons on `/control`.

---

## 12. When in doubt

1. Check `/control` — most data freshness and cron status lives there.
2. Check `/api/cron/health-check` (manual trigger) — daily-issue digest.
3. Check Vercel function logs for the cron in question.
4. Cross-check with **GSC UI directly** — the dashboard is downstream of GSC;
   if GSC says X, the dashboard should also say X within the lag window.

Discrepancies > 10% from GSC UI = bug. Discrepancies < 10% = sampling /
lag / country-filter edge case, document here when found.
