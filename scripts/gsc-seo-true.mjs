#!/usr/bin/env node
import { google } from 'googleapis'
import fs from 'node:fs'

const SITE_URL = 'sc-domain:seo-true.com'
const SITE_URL_PREFIX = 'https://seo-true.com/'
const SA_KEY = 'C:/Users/cohen.000/Downloads/businessdeveloperia-d419cfc0183f.json'

const auth = new google.auth.GoogleAuth({
  keyFile: SA_KEY,
  scopes: ['https://www.googleapis.com/auth/webmasters'],
})

const wm = google.webmasters({ version: 'v3', auth })
const sc = google.searchconsole({ version: 'v1', auth })

async function listSites() {
  const { data } = await wm.sites.list()
  return data.siteEntry || []
}

async function listSitemaps(siteUrl) {
  try {
    const { data } = await wm.sitemaps.list({ siteUrl })
    return data.sitemap || []
  } catch (e) {
    return { error: e.message }
  }
}

async function submitSitemap(siteUrl, feedpath) {
  await wm.sitemaps.submit({ siteUrl, feedpath })
  return 'ok'
}

async function topQueries(siteUrl, days = 30) {
  const end = new Date()
  const start = new Date(Date.now() - days * 86400 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)
  const { data } = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ['query'],
      rowLimit: 25,
    },
  })
  return data.rows || []
}

async function topPages(siteUrl, days = 30) {
  const end = new Date()
  const start = new Date(Date.now() - days * 86400 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)
  const { data } = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ['page'],
      rowLimit: 15,
    },
  })
  return data.rows || []
}

async function inspectUrl(siteUrl, inspectionUrl) {
  try {
    const { data } = await sc.urlInspection.index.inspect({
      requestBody: { inspectionUrl, siteUrl },
    })
    return data.inspectionResult || {}
  } catch (e) {
    return { error: e.message }
  }
}

;(async () => {
  console.log('=== GSC SEO-TRUE.COM ACTIONS ===\n')

  console.log('[1] Listing sites accessible to SA...')
  const sites = await listSites()
  for (const s of sites) {
    console.log(`  - ${s.siteUrl} (${s.permissionLevel})`)
  }
  const matchingSite = sites.find(
    (s) => s.siteUrl === SITE_URL || s.siteUrl === SITE_URL_PREFIX
  )
  if (!matchingSite) {
    console.error(`\nSITE NOT FOUND. Tried: ${SITE_URL} and ${SITE_URL_PREFIX}`)
    console.error('Available siteUrl format examples above. Adjust SITE_URL constant.')
    process.exit(1)
  }
  const targetSiteUrl = matchingSite.siteUrl
  console.log(`\nUsing siteUrl: ${targetSiteUrl}\n`)

  console.log('[2] Current sitemaps state:')
  const sitemapsBefore = await listSitemaps(targetSiteUrl)
  if (Array.isArray(sitemapsBefore)) {
    for (const sm of sitemapsBefore) {
      console.log(
        `  - ${sm.path} | submitted: ${sm.lastSubmitted} | downloaded: ${sm.lastDownloaded} | warnings: ${sm.warnings} | errors: ${sm.errors}`
      )
    }
  } else {
    console.log(`  ERROR: ${sitemapsBefore.error}`)
  }

  console.log('\n[3] Submitting sitemaps...')
  for (const path of [
    'https://seo-true.com/sitemap.xml',
    'https://seo-true.com/sitemap-images.xml',
  ]) {
    try {
      await submitSitemap(targetSiteUrl, path)
      console.log(`  ✓ Submitted ${path}`)
    } catch (e) {
      console.log(`  ✗ FAIL ${path}: ${e.message}`)
    }
  }

  console.log('\n[4] Top queries last 30d:')
  const queries = await topQueries(targetSiteUrl)
  if (queries.length === 0) {
    console.log('  (no data — site too new or no impressions yet)')
  } else {
    for (const r of queries.slice(0, 15)) {
      console.log(
        `  ${r.keys[0].padEnd(50)} | impr: ${r.impressions} | clicks: ${r.clicks} | pos: ${r.position?.toFixed(1)}`
      )
    }
  }

  console.log('\n[5] Top pages last 30d:')
  const pages = await topPages(targetSiteUrl)
  if (pages.length === 0) {
    console.log('  (no data)')
  } else {
    for (const r of pages.slice(0, 10)) {
      const u = r.keys[0].replace('https://seo-true.com', '')
      console.log(
        `  ${u.padEnd(60)} | impr: ${r.impressions} | clicks: ${r.clicks}`
      )
    }
  }

  console.log('\n[6] Inspecting top 5 pillar URLs (indexation status):')
  const piliers = [
    'https://seo-true.com/',
    'https://seo-true.com/blog',
    'https://seo-true.com/a-propos',
    'https://seo-true.com/blog/seo-on-page-les-10-techniques-indispensables-en-2025',
    'https://seo-true.com/blog/link-building-2025-strategie-complete-pour-obtenir-des-backlinks',
  ]
  for (const url of piliers) {
    const r = await inspectUrl(targetSiteUrl, url)
    if (r.error) {
      console.log(`  ${url}\n    ERROR: ${r.error}`)
      continue
    }
    const ix = r.indexStatusResult || {}
    console.log(`  ${url}`)
    console.log(
      `    verdict: ${ix.verdict} | coverage: ${ix.coverageState} | indexing: ${ix.indexingState} | last crawl: ${ix.lastCrawlTime || 'never'}`
    )
  }

  console.log('\n[7] Final sitemaps state:')
  const sitemapsAfter = await listSitemaps(targetSiteUrl)
  if (Array.isArray(sitemapsAfter)) {
    for (const sm of sitemapsAfter) {
      console.log(
        `  - ${sm.path} | submitted: ${sm.lastSubmitted} | warnings: ${sm.warnings} | errors: ${sm.errors}`
      )
    }
  }

  console.log('\n=== DONE ===')
})().catch((e) => {
  console.error('FATAL:', e.message)
  if (e.errors) console.error(JSON.stringify(e.errors, null, 2))
  process.exit(1)
})
