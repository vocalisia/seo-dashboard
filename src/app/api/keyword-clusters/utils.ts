interface Cluster {
  name: string;
  keywords: string[];
  total_volume: number;
  avg_position: number;
  content_suggestion: string;
  priority: string;
}

interface AIClustersResponse {
  clusters: Cluster[];
}

export type KeywordStats = {
  query: string;
  total_clicks: number;
  total_impressions: number;
  avg_position: number;
};

const PRIORITY_VALUES = new Set(["high", "medium", "low"]);

export function parseAIClusters(reply: string): AIClustersResponse | null {
  const candidates = [
    reply.trim(),
    stripMarkdownFence(reply.trim()),
    extractFirstJSONObject(reply),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<AIClustersResponse>;
      if (Array.isArray(parsed.clusters)) {
        return { clusters: parsed.clusters };
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

export function buildFallbackClusters(keywordData: KeywordStats[]): Cluster[] {
  const buckets = new Map<string, KeywordStats[]>();
  for (const row of keywordData) {
    const key = clusterKey(row.query);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([name, rows]) => {
      const totalVolume = rows.reduce((sum, row) => sum + row.total_impressions, 0);
      const avgPosition = rows.length
        ? rows.reduce((sum, row) => sum + row.avg_position, 0) / rows.length
        : 0;
      return {
        name,
        keywords: rows.map((row) => row.query),
        total_volume: totalVolume,
        avg_position: Math.round(avgPosition * 100) / 100,
        content_suggestion: `Créer ou renforcer une page pilier sur "${name.toLowerCase()}".`,
        priority: priorityFromStats(totalVolume, avgPosition),
      };
    })
    .sort((a, b) => b.total_volume - a.total_volume)
    .slice(0, 15);
}

export function normalizeClusters(clusters: Cluster[], keywordData: KeywordStats[]): Cluster[] {
  const knownKeywords = new Set(keywordData.map((row) => row.query));
  const normalized: Cluster[] = [];
  const used = new Set<string>();

  for (const cluster of clusters) {
    const keywords = Array.isArray(cluster.keywords)
      ? cluster.keywords.map(String).filter((kw) => knownKeywords.has(kw) && !used.has(kw))
      : [];
    if (keywords.length === 0) continue;

    keywords.forEach((kw) => used.add(kw));
    normalized.push({
      name: String(cluster.name ?? clusterKey(keywords[0] ?? "Cluster")),
      keywords,
      total_volume: Number(cluster.total_volume ?? 0),
      avg_position: Number(cluster.avg_position ?? 0),
      content_suggestion: String(
        cluster.content_suggestion ?? `Créer ou renforcer une page pilier sur "${cluster.name}".`
      ),
      priority: normalizePriority(cluster.priority),
    });
  }

  if (normalized.length > 0) return normalized;
  return buildFallbackClusters(keywordData);
}

export function normalizePriority(value: unknown): string {
  const priority = String(value ?? "").toLowerCase();
  return PRIORITY_VALUES.has(priority) ? priority : "medium";
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJSONObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i++) {
    const ch = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, i + 1);
    }
  }

  return null;
}

function clusterKey(keyword: string): string {
  const words = keyword
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  const label = words.slice(0, 3).join(" ");
  return titleCase(label || keyword.slice(0, 40) || "Autres requetes");
}

const STOP_WORDS = new Set([
  "avec",
  "aux",
  "dans",
  "des",
  "les",
  "pour",
  "sur",
  "une",
  "the",
  "and",
  "for",
  "with",
  "your",
  "seo",
]);

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function priorityFromStats(volume: number, avgPosition: number): string {
  if (avgPosition > 0 && avgPosition < 20 && volume > 1000) return "high";
  if (avgPosition > 0 && avgPosition < 30) return "medium";
  return "low";
}
