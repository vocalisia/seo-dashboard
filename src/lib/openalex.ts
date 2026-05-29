// OpenAlex API client — free academic citations (100k req/day, no auth).
// https://api.openalex.org/works?search=<domain>&per_page=50
//
// Storage table: `academic_mentions` (see lib/db.ts ensureSchema).

import { logError, logger } from "@/lib/logger";

export interface AcademicWork {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  cited_by_count: number;
  source_type: string;
  source_domain: string;
  source_url: string;
}

interface OAAuthorship {
  author?: { display_name?: string };
}

interface OAWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  type?: string | null;
  primary_location?: {
    source?: { display_name?: string; type?: string };
    landing_page_url?: string;
  };
  authorships?: OAAuthorship[];
}

interface OAResponse {
  results?: OAWork[];
}

function extractDomain(input: string): string {
  return input
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/^www\./, "")
    .trim();
}

function sourceDomainFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Search OpenAlex for academic works mentioning a domain (or brand).
 * Returns up to 50 works ordered by citation count.
 */
export async function searchAcademicMentions(
  domain: string
): Promise<{ works: AcademicWork[] }> {
  const cleaned = extractDomain(domain);
  if (!cleaned) return { works: [] };

  const url = `https://api.openalex.org/works?search=${encodeURIComponent(
    cleaned
  )}&per_page=50`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "SEO-Dashboard-OpenAlex/1.0 (mailto:cohenrichard07@gmail.com)",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      logger.warn({ ctx: "openalex.fetch", status: res.status, domain: cleaned });
      return { works: [] };
    }

    const json = (await res.json()) as OAResponse;
    const works: AcademicWork[] = [];

    for (const w of json.results ?? []) {
      const title = (w.title ?? w.display_name ?? "").trim();
      if (!title) continue;

      const authors = (w.authorships ?? [])
        .map((a) => a.author?.display_name)
        .filter((n): n is string => Boolean(n))
        .slice(0, 10);

      const source_url =
        w.primary_location?.landing_page_url ??
        (w.doi ? `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//, "")}` : w.id ?? "");

      const source_type =
        w.primary_location?.source?.type ?? w.type ?? "unknown";

      works.push({
        title: title.slice(0, 1000),
        authors,
        year: w.publication_year ?? null,
        doi: w.doi ?? null,
        cited_by_count: w.cited_by_count ?? 0,
        source_type,
        source_domain: sourceDomainFromUrl(source_url),
        source_url: (source_url || "").slice(0, 1500),
      });
    }

    works.sort((a, b) => b.cited_by_count - a.cited_by_count);
    return { works };
  } catch (e) {
    logError("openalex.searchAcademicMentions", e, { domain: cleaned });
    return { works: [] };
  }
}
