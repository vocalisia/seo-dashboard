/**
 * GSC / competitor keyword quality filters for SEO autopilot.
 * Keeps route.ts focused on orchestration (SQL, AI, GitHub).
 */

export interface KeywordRow {
  query: string;
  position: string;
  impressions: string;
  clicks: string;
}

/** Normalize for brand / token comparison (lowercase, strip accents, alnum only). */
function normalizeSeoToken(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Collect navigational brand tokens from site name + hostname (to skip branded queries). */
function collectBrandHints(site: { url: string; name: string }): Set<string> {
  const hints = new Set<string>();
  const add = (raw: string) => {
    const n = normalizeSeoToken(raw);
    if (n.length >= 4) hints.add(n);
  };
  for (const part of site.name.split(/[\s\-_]+/)) add(part);
  try {
    const host = new URL(site.url.startsWith("http") ? site.url : `https://${site.url}`).hostname.replace(
      /^www\./,
      ""
    );
    const first = host.split(".")[0] ?? "";
    add(first);
    for (const p of first.split(/-/)) add(p);
  } catch {
    /* ignore invalid URL */
  }
  return hints;
}

/** Tokenize Latin keyword for language fingerprinting (lowercase, no accents). */
function tokenizeKeywordForLang(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ñ/g, "n")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 2);
}

/**
 * Distinctive function / content words per language (for overlap scoring).
 * Keep sets disjoint from obvious English/French shared terms where possible.
 */
const LANG_INDICATOR_WORDS: Record<string, Set<string>> = {
  de: new Set([
    "der",
    "die",
    "das",
    "und",
    "nicht",
    "auch",
    "oder",
    "wie",
    "nach",
    "aus",
    "uber",
    "mit",
    "bei",
    "fur",
    "vom",
    "zum",
    "zur",
    "eine",
    "einen",
    "einem",
    "einer",
    "dieser",
    "diese",
    "dass",
    "werden",
    "konnen",
    "mussen",
    "haben",
    "sein",
    "wird",
    "noch",
    "nur",
    "schon",
    "kampagnen",
    "automatisierung",
    "verkauf",
    "unternehmen",
    "kunstliche",
    "intelligenz",
    "ihre",
    "ihren",
    "dsgvo",
  ]),
  it: new Set([
    "come",
    "nella",
    "degli",
    "delle",
    "sono",
    "essere",
    "questo",
    "questa",
    "anche",
    "dove",
    "quando",
    "perche",
    "molto",
    "tutto",
    "tutti",
    "automazione",
    "aziendale",
    "azienda",
    "intelligenza",
    "artificiale",
    "vendita",
    "italiano",
    "italiana",
  ]),
  es: new Set([
    "como",
    "esta",
    "tambien",
    "muy",
    "este",
    "todos",
    "puede",
    "mas",
    "anos",
    "donde",
    "cuando",
    "porque",
    "nuevo",
    "mejor",
    "espanol",
  ]),
  fr: new Set([
    "le",
    "la",
    "les",
    "des",
    "du",
    "une",
    "pour",
    "dans",
    "avec",
    "est",
    "sont",
    "etre",
    "aussi",
    "tres",
    "comme",
    "cette",
    "ces",
    "aux",
    "que",
    "qui",
    "dont",
    "mais",
    "tout",
    "tous",
    "leur",
    "leurs",
    "chez",
    "francais",
  ]),
  en: new Set([
    "the",
    "with",
    "from",
    "that",
    "what",
    "when",
    "where",
    "which",
    "your",
    "this",
    "these",
    "those",
    "best",
    "how",
    "get",
    "make",
    "most",
    "more",
    "than",
    "into",
    "about",
    "using",
    "guide",
  ]),
  nl: new Set([
    "het",
    "een",
    "van",
    "zijn",
    "naar",
    "ook",
    "niet",
    "meer",
    "welke",
    "waar",
    "hier",
    "alleen",
    "nederlands",
  ]),
  pt: new Set([
    "como",
    "para",
    "nao",
    "uma",
    "mais",
    "voce",
    "tambem",
    "seus",
    "suas",
    "onde",
    "quando",
    "porque",
    "muito",
    "todos",
    "portugues",
  ]),
};

/** Substrings / compounds that strongly imply a language (1 hit = conflict if target differs). */
const LANG_STRONG_PATTERNS: { lang: string; re: RegExp }[] = [
  { lang: "de", re: /\b(kampagnen|automatisierung|unternehmens|künstliche|fürs|furs)\b/i },
  { lang: "it", re: /\b(automazione|aziendale|intelligenza\s+artificiale)\b/i },
  { lang: "es", re: /\b(cómo|anos|también|tambien)\b/i },
];

function keywordConflictsArticleLanguage(raw: string, articleLang: string): boolean {
  const target = articleLang in LANG_INDICATOR_WORDS ? articleLang : "fr";
  const q = raw.trim();
  if (q.length < 4) return false;

  for (const { lang, re } of LANG_STRONG_PATTERNS) {
    if (lang !== target && re.test(q)) return true;
  }

  const tokens = tokenizeKeywordForLang(q);
  if (tokens.length === 0) return false;

  const otherLangs = (Object.keys(LANG_INDICATOR_WORDS) as string[]).filter((l) => l !== target);

  for (const o of otherLangs) {
    if (o === "en" && target !== "en") continue;

    const set = LANG_INDICATOR_WORDS[o];
    let hits = 0;
    for (const w of tokens) {
      if (set.has(w)) hits++;
    }
    if (hits >= 2) return true;
  }

  return false;
}

/**
 * Filters out garbage GSC queries: search operators, URLs, domain-like navigational,
 * single-word brand navigational, etc. Keeps informational / long-tail candidates.
 */
export function isUnusableSeoKeyword(
  raw: string,
  site: { url: string; name: string },
  articleLang?: string
): boolean {
  const q = raw.trim();
  if (q.length < 4) return true;
  const lower = q.toLowerCase();

  if (/^(site|inurl|intitle|intext|cache|related|allinurl|allintitle|allintext|filetype):/i.test(lower)) return true;
  if (/\b(site|inurl|intitle|intext):/i.test(lower)) return true;
  if (/\bsite:/i.test(lower)) return true;

  if (/^https?:\/\//i.test(q)) return true;
  if (/\bwww\.[a-z0-9.-]+\.[a-z]{2,}\b/i.test(lower)) return true;
  if (/^[a-z0-9.-]+\.(com|net|org|io|fr|ch|de|ai|pro|blog|eu|co\.uk)\b/i.test(lower) && !/\s/.test(q))
    return true;

  if (/^\d+$/.test(q.replace(/\s/g, ""))) return true;

  const brandHints = collectBrandHints(site);
  const tokens = lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const alphaOnly = (s: string) => s.replace(/[^a-z0-9]/g, "");

  if (tokens.length === 1) {
    const t = alphaOnly(tokens[0]);
    if (t.length > 0 && t.length < 6) return true;
    if (brandHints.has(t)) return true;
    if (t.length >= 6 && t.length <= 14) {
      for (const h of brandHints) {
        if (t === h || (h.length >= 6 && (t.includes(h) || h.includes(t)))) return true;
      }
    }
  }

  if (tokens.length >= 2) {
    const allBrand = tokens.every((tok) => {
      const a = alphaOnly(tok);
      if (a.length < 3) return true;
      return [...brandHints].some((h) => a === h || (h.length >= 4 && (a.includes(h) || h.includes(a))));
    });
    if (allBrand && tokens.length <= 3) return true;
  }

  if (articleLang && keywordConflictsArticleLanguage(q, articleLang)) return true;

  return false;
}

/** First row whose query passes quality filters, or empty array. */
export function pickFirstUsableKeyword(
  rows: KeywordRow[],
  site: { url: string; name: string },
  articleLang: string
): KeywordRow[] {
  for (const row of rows) {
    if (!isUnusableSeoKeyword(row.query, site, articleLang)) return [row];
  }
  return [];
}
