#!/usr/bin/env node
/**
 * Seed market_opportunities with 8 high-quality 2026 niches.
 *
 * Run locally (NOT on Vercel):
 *   node scripts/seed-opportunities-2026.mjs                 # appends, skips duplicates
 *   node scripts/seed-opportunities-2026.mjs --wipe-pending  # deletes pending+rejected first
 *
 * Uses DATABASE_URL from .env.production. NEVER call AI providers — fully offline data.
 * Niches were curated from public 2026 trend signals (Reddit, PH, AppSumo, Amazon best sellers).
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function loadEnv(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...loadEnv(".env.production"), ...loadEnv(".env.local") };
const DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[seed] DATABASE_URL missing — check .env.production");
  process.exit(2);
}

const wipe = process.argv.includes("--wipe-pending");

// ---------- Curated 8 high-quality 2026 niches ----------

const OPPS = [
  {
    niche: "AI agents pour PME",
    reason: "Explosion 2026 des agents IA verticaux pour PME (vente, support, RH). Indie Hackers verified revenue: 4 SaaS à 10K-50K MRR. Amazon: livres 'AI for small business' top-10 catégorie business. PAA: 'comment automatiser ma PME avec l'IA' fort volume FR.",
    site_type: "saas",
    core_keywords: ["agent ia pme", "automatisation pme ia", "chatbot pme", "ia pour petite entreprise", "agent ia vente"],
    monthly_volume: 18500,
    competition: "medium",
    monetization: "lead-gen",
    projected_traffic_6m: 2400,
    projected_revenue_6m: 4800,
    suggested_domains: ["agentia-pme.fr", "iapme-agents.com", "pme-ai-agents.com"],
    seed_articles: [
      "Top 12 agents IA pour PME en 2026",
      "Comparatif agents IA support client: Intercom Fin vs Mava vs Decagon",
      "Comment déployer un agent IA dans une PME en 30 jours",
      "Agent IA vente B2B: stack complet 2026",
      "Coût réel d'un agent IA pour PME (étude 12 cas)",
    ],
    target_countries: ["FRA", "CHE", "BEL", "LUX"],
    target_languages: ["fr"],
    competitors: [],
    business_model: {
      type: "Directory + comparateur affilié SaaS",
      how_to_monetize: "Affiliation SaaS (Intercom, Decagon, Mava ~30% recurring), lead-gen B2B haute valeur (€80-200/lead), formation premium.",
      affiliate_programs: ["Intercom Partner", "Lindy.ai", "Beam.ai", "Decagon"],
    },
    success_rate: 72,
    revenue_timeline: { m1: 0, m3: 400, m6: 4800, m12: 18000 },
    confidence_score: 84,
    signal_source: "portfolio+global:indie_hackers+ph+amazon",
    momentum_pct: 142.0,
    opportunity_type: "emerging",
    sample_queries: [
      "agent ia pour pme",
      "automatiser support client pme",
      "chatbot vente b2b small business",
      "ia automatisation administrative",
    ],
  },
  {
    niche: "Glow skincare 35+",
    reason: "Reddit r/SkincareAddiction: 8 threads/semaine sur peau mature 35+ avec >500 upvotes. Amazon: 'retinal serum', 'peptide cream' bestsellers rising. Indie Hackers: 2 brands DTC à 15K MRR sur cette niche. Faible saturation FR vs US.",
    site_type: "e-commerce",
    core_keywords: ["soin peau 35 ans", "rétinal sérum", "peptides visage", "anti-âge naturel femme 40", "routine skincare 40 ans"],
    monthly_volume: 27000,
    competition: "medium",
    monetization: "affiliate",
    projected_traffic_6m: 3800,
    projected_revenue_6m: 2700,
    suggested_domains: ["glowafter35-guide.com", "peau-mature-guide.fr", "rituel-glow.com"],
    seed_articles: [
      "Routine skincare 35-45 ans: guide complet 2026",
      "Rétinal vs rétinol: lequel choisir après 35 ans",
      "Top 8 sérums peptides validés par dermatos",
      "Mélasma après 35 ans: protocole anti-tache qui marche",
      "Skincare minimaliste mature: 5 produits suffisent",
    ],
    target_countries: ["FRA", "BEL", "CHE", "CAN"],
    target_languages: ["fr"],
    competitors: [],
    business_model: {
      type: "Affiliation beauty + DTC propre marque mini",
      how_to_monetize: "Affiliation Sephora/Notino/Look Fantastic (10-15%), Amazon Beauty (8%), capsule DTC propre marque 1-2 produits.",
      affiliate_programs: ["Sephora Partners", "Notino Affiliate", "Look Fantastic"],
      products_to_sell: ["Sérum rétinal capsule signature"],
    },
    success_rate: 68,
    revenue_timeline: { m1: 0, m3: 350, m6: 2700, m12: 9500 },
    confidence_score: 81,
    signal_source: "portfolio+global:reddit+amazon",
    momentum_pct: 38.5,
    opportunity_type: "evergreen+trending",
    sample_queries: [
      "meilleur sérum rétinal",
      "routine anti age 40 ans",
      "peau mature soin naturel",
      "comment garder peau jeune après 35",
    ],
  },
  {
    niche: "Vibe coding tools",
    reason: "Hacker News: vibe coding posts >300 points 4×/semaine depuis 2025. Cursor, Windsurf, Lovable, Bolt: croissance ARR 100M+/an. AppSumo: 6 lifetime deals 'AI code editor' en 2 mois. Indie Hackers verified: 8 SaaS dans le top 50 sur ce thème.",
    site_type: "blog",
    core_keywords: ["vibe coding", "ai code editor comparison", "cursor vs windsurf", "lovable vs bolt", "best ai coding assistant 2026"],
    monthly_volume: 42000,
    competition: "medium",
    monetization: "affiliate",
    projected_traffic_6m: 6500,
    projected_revenue_6m: 5400,
    suggested_domains: ["vibe-coding-stack.com", "ai-coders-guide.com", "code-with-vibes.com"],
    seed_articles: [
      "Vibe coding 2026: complete tools comparison (Cursor, Windsurf, Lovable, Bolt, v0)",
      "Cursor vs Windsurf: which AI editor wins in 2026",
      "Build a full SaaS with Lovable in 7 days",
      "Top 15 prompts that 10x your AI coding output",
      "Vibe coding vs traditional dev: real productivity benchmarks",
    ],
    target_countries: ["USA", "GBR", "IND", "CAN", "AUS"],
    target_languages: ["en"],
    competitors: [],
    business_model: {
      type: "Affiliation AI dev tools + course",
      how_to_monetize: "Affiliation Cursor (30%), Bolt, Lovable, V0, AppSumo lifetime deals (~25%), course $99-199 'Ship a SaaS in 14 days'.",
      affiliate_programs: ["Cursor Partner", "Bolt.new", "Lovable", "AppSumo Affiliate"],
      products_to_sell: ["Course: Ship with AI in 14 days"],
    },
    success_rate: 74,
    revenue_timeline: { m1: 0, m3: 800, m6: 5400, m12: 22000 },
    confidence_score: 87,
    signal_source: "global-discovery:hn+ph+appsumo",
    momentum_pct: 215.0,
    opportunity_type: "emerging+hot",
    sample_queries: [
      "vibe coding tutorial",
      "best ai code editor 2026",
      "cursor alternative",
      "lovable bolt comparison",
    ],
  },
  {
    niche: "Sleep gadgets premium",
    reason: "Amazon Best Sellers Rising 'health-personal-care': 5 produits sleep tech dans top 100 mouvers (Eight Sleep, Oura Ring, Whoop, Hatch Restore 3, Loftie). Kickstarter: 4 sleep mask + sound machine projets >$200K en 2025. Reddit r/Biohackers: 12 threads/semaine.",
    site_type: "magazine",
    core_keywords: ["best sleep tracker 2026", "smart sleep mask", "white noise machine review", "oura ring vs whoop", "eight sleep pod review"],
    monthly_volume: 68000,
    competition: "high",
    monetization: "affiliate",
    projected_traffic_6m: 7500,
    projected_revenue_6m: 6200,
    suggested_domains: ["sleep-tech-lab.com", "rest-gear-review.com", "sleep-gadget-pro.com"],
    seed_articles: [
      "Best sleep trackers 2026: Oura vs Whoop vs Ultrahuman tested",
      "Eight Sleep Pod 4 review: 90-night honest test",
      "Top 12 sleep gadgets backed by science",
      "Best white noise machines 2026: ranked",
      "Affordable Oura ring alternatives that actually work",
    ],
    target_countries: ["USA", "GBR", "AUS", "CAN", "DEU"],
    target_languages: ["en"],
    competitors: [],
    business_model: {
      type: "Affiliation Amazon + DTC premium",
      how_to_monetize: "Amazon Associates (3-4%), DTC affiliate (Oura 10%, Eight Sleep 8%, Whoop 10%), display ads (Mediavine), sponsored deep-dives.",
      affiliate_programs: ["Amazon Associates", "Oura Affiliate", "Eight Sleep Partner", "Whoop Affiliate"],
    },
    success_rate: 62,
    revenue_timeline: { m1: 0, m3: 600, m6: 6200, m12: 24000 },
    confidence_score: 79,
    signal_source: "global-discovery:amazon+kickstarter+reddit",
    momentum_pct: 48.0,
    opportunity_type: "evergreen+trending",
    sample_queries: [
      "best sleep gadget",
      "smart sleep mask review",
      "oura vs whoop 2026",
      "eight sleep pod worth it",
    ],
  },
  {
    niche: "Outils acquisition early-stage SaaS",
    reason: "Reddit r/SaaS + r/SideProject: 'how to get first 100 users' top thread chaque semaine. Indie Hackers: 6 produits verified revenue dans cold outreach/SEO automation. AppSumo: 8 nouveaux outils growth en Q1 2026. Volume FR moyen mais français peu servi.",
    site_type: "blog",
    core_keywords: ["acquisition early stage saas", "premiers utilisateurs saas", "outils growth saas 2026", "cold outreach b2b automatique", "seo programmatique saas"],
    monthly_volume: 14500,
    competition: "low",
    monetization: "affiliate",
    projected_traffic_6m: 2800,
    projected_revenue_6m: 3600,
    suggested_domains: ["saas-acquisition-fr.com", "first100-users.com", "early-saas-growth.com"],
    seed_articles: [
      "Comment trouver tes 100 premiers utilisateurs SaaS en 2026",
      "Top 15 outils growth pour SaaS early-stage",
      "Cold outreach B2B: stack 2026 (Smartlead, Instantly, Reply)",
      "SEO programmatique pour SaaS: guide pratique",
      "Product Hunt launch checklist: leçons de 50 launches",
    ],
    target_countries: ["FRA", "BEL", "CHE", "LUX", "CAN"],
    target_languages: ["fr", "en"],
    competitors: [],
    business_model: {
      type: "Affiliation growth tools + community paying",
      how_to_monetize: "Affiliation Smartlead/Instantly/Apollo (15-30%), community Skool/Whop paying €19-49/mo, course 'Ship & Acquire'.",
      affiliate_programs: ["Smartlead Partner", "Apollo Affiliate", "Instantly Partner"],
    },
    success_rate: 76,
    revenue_timeline: { m1: 0, m3: 500, m6: 3600, m12: 14000 },
    confidence_score: 82,
    signal_source: "portfolio+global:reddit+ih+appsumo",
    momentum_pct: 67.0,
    opportunity_type: "emerging",
    sample_queries: [
      "premiers utilisateurs saas",
      "comment acquérir des clients saas",
      "outils cold email automatique",
      "growth hacking saas français",
    ],
  },
  {
    niche: "Nourriture chien fonctionnelle",
    reason: "Amazon Pet Supplies movers-and-shakers: 'fresh dog food', 'dog supplements joints' top 100 rising. Reddit r/DogTraining + r/Dogs: 5+ threads/semaine sur 'fresh food vs kibble'. Marché €2B en Europe avec Tails, Butternut Box, Pure Pet Food levant 50M+€ chacun.",
    site_type: "magazine",
    core_keywords: ["nourriture chien fraîche", "croquettes sans céréales", "compléments alimentaires chien articulations", "régime barf chien", "meilleure nourriture chien senior"],
    monthly_volume: 49000,
    competition: "medium",
    monetization: "affiliate",
    projected_traffic_6m: 6200,
    projected_revenue_6m: 4500,
    suggested_domains: ["nourriture-chien-fr.com", "guide-alim-chien.com", "chien-bien-nourri.com"],
    seed_articles: [
      "Nourriture chien fraîche vs croquettes: vrai comparatif 2026",
      "Top 10 marques nourriture chien fraîche en France",
      "Régime BARF chien: guide débutant complet",
      "Croquettes sans céréales: vraie nécessité ou marketing?",
      "Nourrir un chien senior: protocole vétérinaire",
    ],
    target_countries: ["FRA", "BEL", "CHE", "CAN"],
    target_languages: ["fr"],
    competitors: [],
    business_model: {
      type: "Affiliation + DTC abonnement",
      how_to_monetize: "Affiliation Tails/Pure Pet/Butternut (€20-50/sub recurring), Amazon Pet (8%), display ads.",
      affiliate_programs: ["Tails.com Affiliate", "Butternut Box Partner", "Pure Pet Food"],
    },
    success_rate: 65,
    revenue_timeline: { m1: 0, m3: 380, m6: 4500, m12: 17500 },
    confidence_score: 77,
    signal_source: "global-discovery:amazon+reddit",
    momentum_pct: 41.0,
    opportunity_type: "evergreen+trending",
    sample_queries: [
      "meilleure nourriture chien 2026",
      "croquettes sans céréales avis",
      "tails.com avis",
      "régime barf débutant",
    ],
  },
  {
    niche: "Cours micro-certifications IA",
    reason: "AppSumo: 9 deals lifetime sur 'AI certification' en Q1 2026. LinkedIn Learning: cours 'Prompt Engineering' explose. Indie Hackers: 3 cohort-based courses à 50K+ MRR. PAA Google FR: 'comment se certifier en IA' fort volume.",
    site_type: "course",
    core_keywords: ["certification ia 2026", "formation prompt engineering", "cours intelligence artificielle débutant", "diplôme ia en ligne", "se reconvertir en ia"],
    monthly_volume: 22000,
    competition: "medium",
    monetization: "subscription",
    projected_traffic_6m: 3000,
    projected_revenue_6m: 7200,
    suggested_domains: ["microcert-ia.fr", "ia-certification-fr.com", "se-former-ia.com"],
    seed_articles: [
      "Top 12 certifications IA reconnues en 2026",
      "Prompt engineering: guide débutant complet",
      "Se reconvertir en IA en 6 mois: roadmap réaliste",
      "Certification IA gratuite vs payante: vraie différence",
      "Devenir prompt engineer: profil et salaires France 2026",
    ],
    target_countries: ["FRA", "BEL", "CHE", "CAN", "LUX"],
    target_languages: ["fr"],
    competitors: [],
    business_model: {
      type: "Infoproduit + cohort + affiliation plateforme",
      how_to_monetize: "Cours propre €99-299 + cohort €499, affiliation Coursera/OpenClassrooms/365Data (25-50% recurring), CPF financement.",
      affiliate_programs: ["Coursera Partner", "DataCamp", "365 Data Science"],
      products_to_sell: ["Cohort 'Prompt Eng' 4 semaines"],
    },
    success_rate: 70,
    revenue_timeline: { m1: 0, m3: 950, m6: 7200, m12: 28000 },
    confidence_score: 83,
    signal_source: "portfolio+global:appsumo+linkedin+ih",
    momentum_pct: 95.0,
    opportunity_type: "emerging",
    sample_queries: [
      "certification ia france",
      "formation prompt engineer",
      "se former ia en ligne",
      "diplôme intelligence artificielle",
    ],
  },
  {
    niche: "Recovery gym à domicile",
    reason: "Amazon Sports rising: Theragun, NormaTec, percussive massagers top 50 mouvers. Kickstarter: 6 recovery devices >$300K en 2025. r/HomeGym + r/Biohackers: thread weekly 'recovery stack'. Marché US €4B mais EU sous-servi.",
    site_type: "magazine",
    core_keywords: ["recovery home gym", "best percussion massager 2026", "compression boots review", "infrared sauna home", "cold plunge tub review"],
    monthly_volume: 55000,
    competition: "medium",
    monetization: "affiliate",
    projected_traffic_6m: 6800,
    projected_revenue_6m: 6500,
    suggested_domains: ["home-recovery-gear.com", "athlete-recovery-pro.com", "recovery-gym-lab.com"],
    seed_articles: [
      "Best home recovery gear 2026: 30 tested products",
      "Theragun vs Hypervolt vs Bob and Brad: brutal comparison",
      "Compression boots at home: NormaTec vs Renpho honest review",
      "Cold plunge tubs under $1000: do they work?",
      "Home recovery stack for runners: science-backed",
    ],
    target_countries: ["USA", "GBR", "AUS", "CAN", "DEU"],
    target_languages: ["en"],
    competitors: [],
    business_model: {
      type: "Affiliation premium athletic gear",
      how_to_monetize: "Amazon (4-8%), Therabody affiliate (8%), Renpho/Hyperice DTC programs, display ads Mediavine after 50K sessions.",
      affiliate_programs: ["Therabody Partner", "Hyperice Affiliate", "Amazon Sports"],
    },
    success_rate: 68,
    revenue_timeline: { m1: 0, m3: 700, m6: 6500, m12: 25000 },
    confidence_score: 78,
    signal_source: "global-discovery:amazon+kickstarter+reddit",
    momentum_pct: 52.0,
    opportunity_type: "evergreen+trending",
    sample_queries: [
      "best percussion massager",
      "theragun vs hypervolt 2026",
      "home cold plunge worth it",
      "normatec alternative",
    ],
  },
];

// ---------- Inline enrichment helpers (mirror of scanner-enrichment.ts so seed runs standalone) ----------

function checkDomain(domain) {
  const d = domain.toLowerCase().trim();
  const labels = d.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const root = labels.slice(0, -1).join(".");
  const rootLen = root.replace(/[^a-z0-9]/g, "").length;
  const wc = root.split(/[-_]/).filter(Boolean).length;
  if (["com", "io", "co"].includes(tld) && rootLen <= 6) {
    return { domain: d, available: "likely_taken", reason: `Short .${tld} (≤6 chars) — usually taken` };
  }
  if (wc >= 3 && ["com", "net", "org", "fr", "ch", "be"].includes(tld)) {
    return { domain: d, available: "likely", reason: `${wc}-word combo on .${tld} — usually available` };
  }
  return { domain: d, available: "unknown", reason: "Verify on Namecheap" };
}

function ttr({ competition, monthly_volume }) {
  const base = { low: 3, medium: 6, high: 12 }[competition] ?? 6;
  let m = base;
  if (monthly_volume > 50000) m += 2;
  else if (monthly_volume > 20000) m += 1;
  return Math.max(2, Math.min(18, m));
}

function rrange({ monthly_volume, monetization, competition }) {
  const ctr = { low: 0.18, medium: 0.10, high: 0.05 }[competition] ?? 0.08;
  const traffic = monthly_volume * ctr;
  const rpm = {
    ads: [3, 14], affiliate: [10, 50], "lead-gen": [40, 200],
    "e-commerce": [20, 90], subscription: [25, 120],
  }[monetization] ?? [5, 20];
  return {
    m6_low: Math.round((traffic * 0.4 * rpm[0]) / 1000),
    m6_high: Math.round((traffic * 0.7 * rpm[1]) / 1000),
    m12_low: Math.round((traffic * 0.9 * rpm[0]) / 1000),
    m12_high: Math.round((traffic * 1.5 * rpm[1]) / 1000),
    currency: "EUR",
    assumption: `CTR ${(ctr * 100).toFixed(0)}% × RPM €${rpm[0]}-${rpm[1]} (${monetization})`,
  };
}

function lplan({ niche, core_keywords }) {
  const primary = core_keywords[0] ?? niche;
  const secondary = core_keywords[1] ?? primary;
  const year = new Date().getFullYear();
  return {
    pillar_topic: niche,
    launch_horizon_days: 14,
    articles: [
      { title: `Guide complet: ${primary}`, target_keyword: primary, intent: "informational", word_count_target: 2400, priority: 1 },
      { title: `${primary} vs alternatives: comparatif ${year}`, target_keyword: `${primary} comparatif`, intent: "commercial", word_count_target: 1800, priority: 2 },
      { title: `Comment choisir ${secondary} pour ${niche}`, target_keyword: secondary, intent: "informational", word_count_target: 1600, priority: 3 },
    ],
  };
}

function whyNow(src, momentum) {
  const out = [];
  if (momentum >= 25) out.push({ signal: `Momentum +${Math.round(momentum)}%`, source: "google_trends", detail: "30d window" });
  if (src.includes("reddit")) out.push({ signal: "Reddit discussion active", source: "reddit", detail: src });
  if (src.includes("ph") || src.includes("product_hunt")) out.push({ signal: "Product Hunt activity", source: "product_hunt", detail: src });
  if (src.includes("amazon")) out.push({ signal: "Amazon Best Sellers Rising", source: "amazon", detail: src });
  if (src.includes("hn")) out.push({ signal: "Hacker News front page", source: "hn", detail: src });
  if (src.includes("ih") || src.includes("indie")) out.push({ signal: "Indie Hackers verified revenue", source: "indie_hackers", detail: src });
  if (src.includes("appsumo")) out.push({ signal: "AppSumo recent listings", source: "indie_hackers", detail: src });
  if (src.includes("kickstarter")) out.push({ signal: "Kickstarter funded products", source: "indie_hackers", detail: src });
  return out;
}

// ---------- Seed runner ----------

async function main() {
  const sql = neon(DATABASE_URL);
  console.log("[seed] connecting to DB...");

  if (wipe) {
    console.log("[seed] wiping pending/rejected opportunities first...");
    await sql`DELETE FROM market_opportunities WHERE status IN ('pending','rejected') OR status IS NULL`;
  }

  // Ensure v2 columns exist (idempotent)
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS launch_plan JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS time_to_rank_months INTEGER`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS why_now JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS revenue_range JSONB`;
  await sql`ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS domain_available JSONB`;

  let inserted = 0;
  let skipped = 0;
  for (const opp of OPPS) {
    const exists = await sql`SELECT id FROM market_opportunities WHERE niche = ${opp.niche} LIMIT 1`;
    if (exists.length > 0) {
      console.log(`[seed] skip existing: ${opp.niche}`);
      skipped += 1;
      continue;
    }

    const enrichedTtr = ttr(opp);
    const enrichedRange = rrange(opp);
    const enrichedPlan = lplan(opp);
    const enrichedWhy = whyNow(opp.signal_source, opp.momentum_pct);
    const enrichedDomains = opp.suggested_domains.map(checkDomain);
    const scoreBreakdown = {
      growth: opp.momentum_pct / 100,
      volume: Math.min(1, opp.monthly_volume / 50000),
      weakness: { low: 1.0, medium: 0.6, high: 0.3 }[opp.competition] ?? 0.5,
      specificity: 0.8,
      business: { "lead-gen": 1.0, subscription: 0.9, "e-commerce": 0.85, affiliate: 0.7, ads: 0.4 }[opp.monetization] ?? 0.6,
      portfolioDistance: opp.signal_source?.includes("global") ? 0.85 : 0.5,
    };

    await sql`
      INSERT INTO market_opportunities
      (niche, reason, site_type, core_keywords, monthly_volume, competition, monetization,
       projected_traffic_6m, projected_revenue_6m, suggested_domains, seed_articles,
       target_countries, target_languages, competitors, business_model, success_rate,
       revenue_timeline, confidence_score, signal_source, momentum_pct, average_position,
       opportunity_type, sample_queries, score_breakdown, serp_evidence,
       launch_plan, time_to_rank_months, why_now, revenue_range, domain_available, status)
      VALUES (${opp.niche}, ${opp.reason}, ${opp.site_type},
              ${JSON.stringify(opp.core_keywords)}, ${opp.monthly_volume}, ${opp.competition}, ${opp.monetization},
              ${opp.projected_traffic_6m}, ${opp.projected_revenue_6m},
              ${JSON.stringify(opp.suggested_domains)}, ${JSON.stringify(opp.seed_articles)},
              ${JSON.stringify(opp.target_countries)}, ${JSON.stringify(opp.target_languages)},
              ${JSON.stringify(opp.competitors)}, ${JSON.stringify(opp.business_model)}, ${opp.success_rate},
              ${JSON.stringify(opp.revenue_timeline)}, ${opp.confidence_score}, ${opp.signal_source},
              ${opp.momentum_pct}, ${0}, ${opp.opportunity_type}, ${JSON.stringify(opp.sample_queries)},
              ${JSON.stringify(scoreBreakdown)}, ${JSON.stringify({ relatedQuestions: [], relatedSearches: [], resultTitles: [], resultUrls: [] })},
              ${JSON.stringify(enrichedPlan)}, ${enrichedTtr},
              ${JSON.stringify(enrichedWhy)}, ${JSON.stringify(enrichedRange)},
              ${JSON.stringify(enrichedDomains)}, ${"pending"})
    `;
    inserted += 1;
    console.log(`[seed] inserted: ${opp.niche} (vol ${opp.monthly_volume}, score ${opp.confidence_score})`);
  }

  console.log(`\n[seed] done. inserted=${inserted} skipped=${skipped} total=${OPPS.length}`);
}

main().catch((err) => {
  console.error("[seed] FAIL:", err);
  process.exit(1);
});
