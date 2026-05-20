/**
 * Health-check engine — scanne un site et détecte les problèmes récurrents
 * sans intervention humaine. Appelé par /api/cron/health-check quotidien.
 *
 * Détecte :
 *  - GA4 manquant / consent mode absent / consent logic inversée / consent après init
 *  - SEO tags : canonical, og:image, og:type, og:url, title length, meta desc length, H1
 *  - Schema JSON-LD : présence + parsing valide
 *  - Doublons gtag.js (indique double tracking)
 */

export type HealthIssue = {
  severity: "critical" | "high" | "medium" | "low";
  category: "ga4" | "seo" | "schema" | "html";
  code: string;
  message: string;
};

export type HealthReport = {
  url: string;
  scanned_at: string;
  http_status: number;
  fetched: boolean;
  issues: HealthIssue[];
  ga4_id: string | null;
  has_consent_mode: boolean;
  has_schema_jsonld: boolean;
};

const TITLE_MAX = 70;
const TITLE_MIN = 10;
const DESC_MAX = 160;
const DESC_MIN = 50;

/** Fetch page HTML with short timeout. Returns status + body (truncated to 200KB). */
export async function fetchPage(
  url: string,
  timeoutMs = 10_000
): Promise<{ status: number; body: string; ok: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { "User-Agent": "SEO-Dashboard-Health-Check/1.0" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    const raw = await res.text();
    return { status: res.status, body: raw.slice(0, 200_000), ok: res.ok };
  } catch {
    return { status: 0, body: "", ok: false };
  }
}

/**
 * Analyse les tags GA4 et détecte les pièges classiques.
 * Returns issues + extracted measurement ID + consent flags.
 */
export function analyzeGA4(html: string): {
  ga4_id: string | null;
  has_consent_mode: boolean;
  issues: HealthIssue[];
} {
  const issues: HealthIssue[] = [];
  const ga4Matches = Array.from(html.matchAll(/G-[A-Z0-9]{8,12}/g));
  const ga4Ids = Array.from(new Set(ga4Matches.map((m) => m[0])));
  const ga4_id = ga4Ids[0] ?? null;

  if (!ga4_id) {
    // GTM container alone (GT-) counts as tracking present — don't flag
    if (!/GTM-[A-Z0-9]{6,}/.test(html) && !/GT-[A-Z0-9]{6,}/.test(html)) {
      issues.push({
        severity: "critical",
        category: "ga4",
        code: "ga4_missing",
        message: "Aucun GA4 ni GTM container détecté — site invisible côté analytics.",
      });
    }
    return { ga4_id, has_consent_mode: false, issues };
  }

  if (ga4Ids.length > 1) {
    issues.push({
      severity: "high",
      category: "ga4",
      code: "ga4_multiple_ids",
      message: `${ga4Ids.length} GA4 IDs distincts détectés (${ga4Ids.join(", ")}) — risque de double-tracking ou mauvaise migration.`,
    });
  }

  // Position du premier gtag.js SCRIPT (pas <link rel=preload> qui est juste un hint).
  // Cherche `<script ... src="...gtag/js...">` pour mesurer l'ordre consent vs execution réelle.
  const gtagScriptMatch = html.match(
    /<script\s[^>]*src=["'][^"']*googletagmanager\.com\/gtag\/js[^"']*["']/
  );
  const gtagJsIdx = gtagScriptMatch && typeof gtagScriptMatch.index === "number"
    ? gtagScriptMatch.index
    : -1;
  const consentDefaultIdx = html.indexOf("gtag('consent','default'");
  const consentDefaultAltIdx = html.indexOf('gtag("consent","default"');
  const consentSpaceIdx = html.indexOf("gtag('consent', 'default'");
  const consentSpaceAltIdx = html.indexOf('gtag("consent", "default"');
  const consentIdx = Math.min(
    ...[
      consentDefaultIdx,
      consentDefaultAltIdx,
      consentSpaceIdx,
      consentSpaceAltIdx,
    ].filter((i) => i >= 0)
  );

  const has_consent_mode = Number.isFinite(consentIdx);

  if (!has_consent_mode) {
    issues.push({
      severity: "critical",
      category: "ga4",
      code: "ga4_no_consent_mode",
      message: "GA4 présent sans consent mode v2 — viole RGPD/EU en absence de banner CMP.",
    });
  } else if (gtagJsIdx > -1 && consentIdx > gtagJsIdx) {
    issues.push({
      severity: "critical",
      category: "ga4",
      code: "ga4_consent_after_init",
      message:
        `Consent default défini APRÈS chargement gtag.js (pos ${consentIdx} vs ${gtagJsIdx}) — la 1re page vue est trackée sans consentement.`,
    });
  }

  // Logique consent inversée (rejected ? granted : denied) — track sur refus
  const invertedRegex =
    /rejected\s*\?\s*['"]granted['"]\s*:\s*['"]denied['"]/i;
  if (invertedRegex.test(html)) {
    issues.push({
      severity: "critical",
      category: "ga4",
      code: "ga4_consent_inverted",
      message:
        "Logique consent inversée détectée (`rejected ? granted : denied`) — tracking actif sur les refus EU.",
    });
  }

  // Logique opt-out (rejected/declined ? denied : granted) — track par défaut
  const optoutRegex =
    /(?:rejected|declined)\s*\?\s*['"]denied['"]\s*:\s*['"]granted['"]/i;
  if (optoutRegex.test(html)) {
    issues.push({
      severity: "critical",
      category: "ga4",
      code: "ga4_consent_optout",
      message:
        "Logique consent OPT-OUT détectée (`rejected ? denied : granted`) — tracking actif par défaut, viole RGPD opt-in EU.",
    });
  }

  // Snippet gtag.js dupliqué (compte d'occurrences)
  const gtagJsCount = (html.match(/googletagmanager\.com\/gtag\/js/g) || [])
    .length;
  if (gtagJsCount > 1) {
    issues.push({
      severity: "high",
      category: "ga4",
      code: "ga4_duplicate_snippet",
      message: `Snippet gtag.js injecté ${gtagJsCount}× — risque de double-fire page_view (sessions gonflées).`,
    });
  }

  // debug_mode en prod
  if (/['"]debug_mode['"]\s*:\s*true/.test(html)) {
    issues.push({
      severity: "medium",
      category: "ga4",
      code: "ga4_debug_mode_in_prod",
      message: "`debug_mode: true` détecté — pollue les rapports GA4 en production.",
    });
  }

  return { ga4_id, has_consent_mode, issues };
}

/** Analyse SEO tags critiques. */
export function analyzeSEO(html: string): {
  has_schema_jsonld: boolean;
  issues: HealthIssue[];
} {
  const issues: HealthIssue[] = [];
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : html.slice(0, 50_000);

  // Title
  const titles = head.match(/<title[^>]*>([^<]*)<\/title>/gi) || [];
  if (titles.length === 0) {
    issues.push({ severity: "high", category: "seo", code: "no_title", message: "Pas de <title>." });
  } else if (titles.length > 1) {
    issues.push({
      severity: "medium",
      category: "seo",
      code: "duplicate_title",
      message: `${titles.length} balises <title> — Google ignore les doublons.`,
    });
  } else {
    const tText = (titles[0] ?? "").replace(/<\/?title[^>]*>/gi, "").trim();
    if (tText.length < TITLE_MIN) {
      issues.push({
        severity: "medium",
        category: "seo",
        code: "title_too_short",
        message: `Title trop court (${tText.length} ch < ${TITLE_MIN}).`,
      });
    } else if (tText.length > TITLE_MAX) {
      issues.push({
        severity: "low",
        category: "seo",
        code: "title_too_long",
        message: `Title ${tText.length} ch > ${TITLE_MAX} — Google tronquera dans SERP.`,
      });
    }
  }

  // Meta description
  const descs = Array.from(
    head.matchAll(
      /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/gi
    )
  );
  if (descs.length === 0) {
    issues.push({
      severity: "medium",
      category: "seo",
      code: "no_meta_description",
      message: "Pas de meta description.",
    });
  } else if (descs.length > 1) {
    issues.push({
      severity: "medium",
      category: "seo",
      code: "duplicate_meta_description",
      message: `${descs.length} meta descriptions.`,
    });
  } else {
    const d = descs[0][1];
    if (d.length < DESC_MIN) {
      issues.push({
        severity: "low",
        category: "seo",
        code: "desc_too_short",
        message: `Meta description trop courte (${d.length} ch < ${DESC_MIN}).`,
      });
    } else if (d.length > DESC_MAX) {
      issues.push({
        severity: "low",
        category: "seo",
        code: "desc_too_long",
        message: `Meta description ${d.length} ch > ${DESC_MAX} — Google tronquera.`,
      });
    }
  }

  // Canonical
  const cans = Array.from(
    head.matchAll(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/gi)
  );
  if (cans.length === 0) {
    issues.push({
      severity: "high",
      category: "seo",
      code: "no_canonical",
      message: "Pas de canonical — duplicate content risk.",
    });
  } else if (cans.length > 1) {
    issues.push({
      severity: "critical",
      category: "seo",
      code: "duplicate_canonical",
      message: `${cans.length} canonicals — GSC flagge, Google confus sur la version canonique.`,
    });
  }

  // OG tags
  if (!/<meta\s+[^>]*property=["']og:title["']/i.test(head)) {
    issues.push({ severity: "low", category: "seo", code: "no_og_title", message: "Pas d'og:title." });
  }
  if (!/<meta\s+[^>]*property=["']og:image["']/i.test(head)) {
    issues.push({
      severity: "medium",
      category: "seo",
      code: "no_og_image",
      message: "Pas d'og:image — pas de preview sociale.",
    });
  }
  if (!/<meta\s+[^>]*property=["']og:type["']/i.test(head)) {
    issues.push({ severity: "low", category: "seo", code: "no_og_type", message: "Pas d'og:type." });
  }
  if (!/<meta\s+[^>]*property=["']og:url["']/i.test(head)) {
    issues.push({ severity: "low", category: "seo", code: "no_og_url", message: "Pas d'og:url." });
  }

  // html[lang]
  if (!/<html[^>]*\slang=["']/i.test(html)) {
    issues.push({
      severity: "high",
      category: "seo",
      code: "no_html_lang",
      message: "Pas d'attribut <html lang> — accessibilité + signal hreflang manquant.",
    });
  }

  // X-Robots noindex via meta
  const noindexMeta = head.match(
    /<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']*noindex[^"']*)["']/i
  );
  if (noindexMeta) {
    issues.push({
      severity: "critical",
      category: "seo",
      code: "noindex_meta",
      message: `meta robots ${noindexMeta[1]} — page bloquée des SERPs.`,
    });
  }

  // H1
  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) {
    issues.push({ severity: "high", category: "seo", code: "no_h1", message: "Pas de H1." });
  } else if (h1s.length > 1) {
    issues.push({
      severity: "low",
      category: "seo",
      code: "duplicate_h1",
      message: `${h1s.length} H1 — préférer 1 seul.`,
    });
  }

  // Schema JSON-LD
  const schemas = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  let has_schema_jsonld = false;
  if (schemas && schemas.length > 0) {
    has_schema_jsonld = true;
    for (let i = 0; i < schemas.length; i++) {
      const m = schemas[i].match(
        /<script[^>]*>([\s\S]*?)<\/script>/i
      );
      if (m) {
        try {
          JSON.parse(m[1].trim());
        } catch {
          issues.push({
            severity: "medium",
            category: "schema",
            code: "broken_jsonld",
            message: `JSON-LD #${i + 1} invalide (parse error).`,
          });
        }
      }
    }
  } else {
    issues.push({
      severity: "medium",
      category: "schema",
      code: "no_jsonld",
      message: "Pas de JSON-LD — bloquant pour AI Overviews + rich snippets.",
    });
  }

  return { has_schema_jsonld, issues };
}

/** Run full health check on a single URL. */
export async function checkSiteHealth(url: string): Promise<HealthReport> {
  const scanned_at = new Date().toISOString();
  const { status, body, ok } = await fetchPage(url);

  if (!ok || !body) {
    return {
      url,
      scanned_at,
      http_status: status,
      fetched: false,
      issues: [
        {
          severity: "critical",
          category: "html",
          code: "fetch_failed",
          message: `Site inaccessible (HTTP ${status}).`,
        },
      ],
      ga4_id: null,
      has_consent_mode: false,
      has_schema_jsonld: false,
    };
  }

  const ga4 = analyzeGA4(body);
  const seo = analyzeSEO(body);

  return {
    url,
    scanned_at,
    http_status: status,
    fetched: true,
    issues: [...ga4.issues, ...seo.issues],
    ga4_id: ga4.ga4_id,
    has_consent_mode: ga4.has_consent_mode,
    has_schema_jsonld: seo.has_schema_jsonld,
  };
}
