export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

const TITLE_INTERNAL_LABELS = [
  /\baio\b/gi,
  /\bllm\s*seo\b/gi,
  /\bseo\s+principal\b/gi,
  /\bancrage\s+seo\b/gi,
  /\boptimis[ée]?\s+ia\b/gi,
];

const TITLE_BANNED_PATTERNS = [
  /https?:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /\b(?:price|pricing|tarif|tarifs)\b/gi,
  /[$€£¥₣]|(?:\bchf\b|\beur\b|\busd\b|\bgbp\b)/gi,
  /[%§]/g,
  /\/\.\//g,
  /\/\/+/g,
];

function stripTitleJunk(value: string): string {
  let cleaned = value
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of TITLE_INTERNAL_LABELS) {
    cleaned = cleaned.replace(pattern, "");
  }

  for (const pattern of TITLE_BANNED_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return cleaned
    .replace(/\s*\/+\s*/g, " ")
    .replace(/\s*[-|]{2,}\s*/g, " ")
    .replace(/\s*([:;,.!?])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:|,.;]+|[\s\-:|,.;]+$/g, "")
    .trim();
}

function capitalizeFirst(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength + 1);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(maxLength * 0.6) ? truncated.slice(0, lastSpace) : value.slice(0, maxLength);
  return cut.replace(/[\s\-:|,.;]+$/g, "").trim();
}

export function normalizeSeoTitle(
  rawTitle: string | null | undefined,
  keyword: string,
  maxLength = 60
): string {
  const cleanKeyword = capitalizeFirst(stripTitleJunk(keyword));
  const cleanedTitle = stripTitleJunk(rawTitle ?? "");
  const keywordLower = cleanKeyword.toLowerCase();
  const titleLower = cleanedTitle.toLowerCase();

  const titleHasKeyword = keywordLower.length > 0 && titleLower.includes(keywordLower);
  const titleStartsWithKeyword = keywordLower.length > 0 && titleLower.startsWith(keywordLower);
  const titleTooLong = cleanedTitle.length > maxLength;
  const titleTooShort = cleanedTitle.length < 24;
  const titleLooksBad =
    !cleanedTitle ||
    !titleHasKeyword ||
    !titleStartsWithKeyword ||
    titleTooLong ||
    titleTooShort;

  if (!titleLooksBad) {
    return truncateAtWordBoundary(capitalizeFirst(cleanedTitle), maxLength);
  }

  let suffix = "";
  if (titleStartsWithKeyword) {
    suffix = cleanedTitle.slice(cleanKeyword.length).replace(/^[:\-|,\s]+/, "").trim();
  }

  suffix = stripTitleJunk(suffix)
    .replace(/\b(?:guide complet|ultimate guide|tout savoir|d[eé]couvrez)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!/[a-zà-ÿ]/i.test(suffix) || suffix.length < 4) {
    suffix = "";
  }

  let nextTitle = cleanKeyword;
  if (suffix) {
    const candidate = `${cleanKeyword}: ${suffix}`;
    if (candidate.length <= maxLength) {
      nextTitle = candidate;
    }
  }

  return truncateAtWordBoundary(nextTitle, maxLength);
}
