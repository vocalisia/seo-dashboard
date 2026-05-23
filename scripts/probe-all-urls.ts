import { resolveSiteRepoConfig, isPublishBlockedByDomain } from "../src/lib/autopilot-config";
import { buildPublishedArticleUrl } from "../src/lib/autopilot-published-url";

// Real existing article filenames per repo (sans .mdx/.md, sans date pour noDateSuffix)
const realSlugs: Record<string, { keyword: string; date: string; lang: string }[]> = {
  // trustly: noDateSuffix=true → slug = filename direct (sans date)
  "trustly-ai.com": [
    { keyword: "ai affiliate marketing strategy", date: "2026-04-15", lang: "en" },
    { keyword: "ai advertising optimize ads", date: "2026-04-15", lang: "en" },
  ],
  // iapmesuisse: slug = filename (some have date, some don't)
  "iapmesuisse.ch": [
    { keyword: "agence ia pme suisse comparatif", date: "2026-04-15", lang: "fr" },
  ],
  // hub-ai/ai-due: slug = filename, no date suffix in existing files
  "ai-due.com": [
    { keyword: "agent ia autonome guide complet", date: "2026-03-26", lang: "fr" },
    { keyword: "11 essential ai tools businesses 2026", date: "2026-03-26", lang: "en" },
  ],
  // whatsapp: slug = filename
  "agentic-whatsup.com": [
    { keyword: "5 cas usage agent ia whatsapp", date: "2026-04-15", lang: "fr" },
  ],
  // lead-gene
  "lead-gene.com": [
    { keyword: "generation leads b2b ia guide 2026", date: "2026-04-15", lang: "fr" },
  ],
};

// Sites enabled in SITE_REPO_MAP that we expect to publish
const enabledSites = [
  { name: "vocalis-blog", url: "https://vocalis.blog" },
  { name: "vocalis-pro", url: "https://vocalis.pro" },
  { name: "trustly", url: "https://trustly-ai.com" },
  { name: "iapmesuisse", url: "https://iapmesuisse.ch" },
  { name: "ai-due", url: "https://ai-due.com" },
  { name: "hub-ai", url: "https://ai-due.com" },
  { name: "whatsapp", url: "https://agentic-whatsup.com" },
  { name: "lead-gene", url: "https://lead-gene.com" },
  { name: "woman-cute", url: "https://woman-cute.com" },
];

async function probe(url: string): Promise<{ status: number; soft404: boolean }> {
  try {
    const r = await fetch(url, { redirect: "follow" });
    let soft404 = false;
    if (r.ok) {
      const html = await r.text();
      const t = html.match(/<title>([^<]+)<\/title>/i);
      const title = (t?.[1] ?? "").toLowerCase();
      if (/(introuvable|not\s+found|\b404\b)/i.test(title)) soft404 = true;
    }
    return { status: r.status, soft404 };
  } catch (e) {
    return { status: 0, soft404: false };
  }
}

async function main(): Promise<void> {
  console.log("Live HTTP probe — autopilot would generate these URLs:");
  console.log("=".repeat(110));
  let okCount = 0, badCount = 0;
  for (const site of enabledSites) {
    const { repoConfig } = resolveSiteRepoConfig(site.name);
    if (!repoConfig || repoConfig.enabled === false) continue;
    if (isPublishBlockedByDomain(site.url)) continue;

    const host = new URL(site.url).hostname.replace(/^www\./, "");
    const slugs = realSlugs[host] ?? realSlugs[host.replace(".pro", ".blog")] ?? [];

    if (slugs.length === 0) {
      console.log(`${site.name.padEnd(15)} | (no real test slugs available — site uses catch-all or new pipeline)`);
      continue;
    }

    for (const s of slugs) {
      const url = buildPublishedArticleUrl(site.url, s.keyword, s.lang, repoConfig, s.date);
      const r = await probe(url);
      const ok = r.status >= 200 && r.status < 400 && !r.soft404;
      if (ok) okCount++; else badCount++;
      const verdict = ok ? "OK 200" : (r.soft404 ? "soft-404" : `BAD ${r.status}`);
      console.log(`${site.name.padEnd(15)} | ${verdict.padEnd(15)} | ${url}`);
    }
  }
  console.log("=".repeat(110));
  console.log(`Probed: ${okCount + badCount} | OK: ${okCount} | BAD: ${badCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
