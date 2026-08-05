export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/api-auth";

const BodySchema = z.object({
  keywords: z.array(z.string().trim().min(2).max(200)).min(1).max(200),
});

interface Cluster {
  cluster_name: string;
  keywords: string[];
}

const STOPWORDS = new Set([
  "avec", "dans", "des", "pour", "sans", "sur", "une", "les", "aux", "par",
  "and", "for", "from", "the", "with", "without", "best", "meilleur", "meilleure",
  "comment", "guide", "avis", "prix",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function clusterName(keywords: string[]): string {
  const frequencies = new Map<string, number>();
  for (const keyword of keywords) {
    for (const token of new Set(tokens(keyword))) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }
  const selected = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([token]) => token);
  return selected.join(" ") || keywords[0].slice(0, 80);
}

export function clusterKeywordsLocally(input: string[]): Cluster[] {
  const keywords = Array.from(new Set(input.map((keyword) => keyword.trim()).filter(Boolean)));
  const buckets: Array<{ keywords: string[]; tokens: Set<string> }> = [];

  for (const keyword of keywords) {
    const keywordTokens = new Set(tokens(keyword));
    let bestIndex = -1;
    let bestOverlap = 0;
    for (let index = 0; index < buckets.length; index += 1) {
      const overlap = intersectionSize(keywordTokens, buckets[index].tokens);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestOverlap >= 1) {
      const bucket = buckets[bestIndex];
      bucket.keywords.push(keyword);
      for (const token of keywordTokens) bucket.tokens.add(token);
    } else {
      buckets.push({ keywords: [keyword], tokens: keywordTokens });
    }
  }

  return buckets
    .map((bucket) => ({
      cluster_name: clusterName(bucket.keywords),
      keywords: bucket.keywords,
    }))
    .sort((a, b) => b.keywords.length - a.keywords.length || a.cluster_name.localeCompare(b.cluster_name));
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const clusters = clusterKeywordsLocally(parsed.data.keywords);
  return NextResponse.json({
    success: true,
    clusters,
    source: "local_semantic_tokens",
    api_key_required: false,
    notice: "Clustering lexical déterministe; aucune difficulté ni volume n'est déduit.",
  });
}
