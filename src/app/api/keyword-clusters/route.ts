import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";

export const dynamic = "force-dynamic";

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

interface ClusterWithStats {
  cluster_name: string;
  keywords: string[];
  total_clicks: number;
  total_impressions: number;
  avg_position: number;
  content_suggestion: string;
  priority: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");
    const cached = searchParams.get("cached");

    if (!siteId) {
      return NextResponse.json({ error: "site_id required" }, { status: 400 });
    }

    const siteIdNum = parseInt(siteId, 10);
    const sql = getSQL();

    // Return stored clusters without re-running AI
    if (cached === "true") {
      const stored = await sql`
        SELECT cluster_name, keywords, total_clicks, total_impressions,
               avg_position, content_suggestion, priority, created_at
        FROM keyword_clusters
        WHERE site_id = ${siteIdNum}
        ORDER BY total_impressions DESC
      `;

      const clusters = (stored as Record<string, unknown>[]).map(formatStoredCluster);

      return NextResponse.json({
        clusters,
        summary: buildSummary(clusters),
        cached: true,
      });
    }

    // 1. Fetch keywords from GSC (last 30d, country IS NULL, limit 200)
    const kwRows = await sql`
      SELECT
        query,
        SUM(clicks) as total_clicks,
        SUM(impressions) as total_impressions,
        AVG(position) as avg_position
      FROM search_console_data
      WHERE site_id = ${siteIdNum}
        AND date >= NOW() - INTERVAL '30 days'
        AND country IS NULL
        AND query IS NOT NULL
        AND query != ''
      GROUP BY query
      ORDER BY SUM(impressions) DESC
      LIMIT 200
    `;

    const keywordData = kwRows as Record<string, unknown>[];

    if (keywordData.length === 0) {
      return NextResponse.json(
        { error: "No keywords found for this site in the last 30 days" },
        { status: 404 }
      );
    }

    const keywords = keywordData.map((r) => r.query as string);

    // 2. Ask AI to cluster
    const prompt = `Group these keywords into 5-15 semantic topic clusters. Each cluster should represent a coherent topic/theme.

Keywords:
${keywords.join("\n")}

RESPOND IN STRICT JSON ONLY:
{
  "clusters": [
    {
      "name": "Cluster name (short, descriptive)",
      "keywords": ["kw1", "kw2", "kw3"],
      "total_volume": 5000,
      "avg_position": 15.2,
      "content_suggestion": "Brief content suggestion for this cluster",
      "priority": "high|medium|low"
    }
  ]
}

Rules:
- Each keyword appears in exactly one cluster
- Sort clusters by total estimated volume DESC
- priority: high if avg_position < 20 and volume > 1000, medium if < 30, low otherwise
- content_suggestion should be a specific article idea targeting the cluster`;

    const aiResponse = await askAI(
      [{ role: "user", content: prompt }],
      "cluster",
      4000
    );

    // 3. Parse AI response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI returned invalid JSON" },
        { status: 502 }
      );
    }

    const parsed: AIClustersResponse = JSON.parse(jsonMatch[0]);

    if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
      return NextResponse.json(
        { error: "AI response missing clusters array" },
        { status: 502 }
      );
    }

    // 4. Build lookup map for GSC data enrichment
    const kwMap = new Map<string, { clicks: number; impressions: number; position: number }>();
    for (const row of keywordData) {
      kwMap.set(row.query as string, {
        clicks: Number(row.total_clicks),
        impressions: Number(row.total_impressions),
        position: Number(row.avg_position),
      });
    }

    // Enrich each cluster with actual GSC data
    const enrichedClusters: ClusterWithStats[] = parsed.clusters.map((c) => {
      let totalClicks = 0;
      let totalImpressions = 0;
      let positionSum = 0;
      let positionCount = 0;

      for (const kw of c.keywords) {
        const data = kwMap.get(kw);
        if (data) {
          totalClicks += data.clicks;
          totalImpressions += data.impressions;
          positionSum += data.position;
          positionCount += 1;
        }
      }

      const avgPos = positionCount > 0
        ? Math.round((positionSum / positionCount) * 100) / 100
        : c.avg_position;

      return {
        cluster_name: c.name,
        keywords: c.keywords,
        total_clicks: totalClicks,
        total_impressions: totalImpressions,
        avg_position: avgPos,
        content_suggestion: c.content_suggestion,
        priority: c.priority,
      };
    });

    // 5. Create table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS keyword_clusters (
        id SERIAL PRIMARY KEY,
        site_id INTEGER REFERENCES sites(id),
        cluster_name VARCHAR(200),
        keywords JSONB,
        total_clicks INTEGER,
        total_impressions INTEGER,
        avg_position DECIMAL(6,2),
        content_suggestion TEXT,
        priority VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // 6. Clear old clusters for this site, then insert new ones
    await sql`DELETE FROM keyword_clusters WHERE site_id = ${siteIdNum}`;

    for (const cluster of enrichedClusters) {
      await sql`
        INSERT INTO keyword_clusters
          (site_id, cluster_name, keywords, total_clicks, total_impressions, avg_position, content_suggestion, priority)
        VALUES (
          ${siteIdNum},
          ${cluster.cluster_name},
          ${JSON.stringify(cluster.keywords)},
          ${cluster.total_clicks},
          ${cluster.total_impressions},
          ${cluster.avg_position},
          ${cluster.content_suggestion},
          ${cluster.priority}
        )
      `;
    }

    // 7. Return clusters + summary
    return NextResponse.json({
      clusters: enrichedClusters,
      summary: buildSummary(enrichedClusters),
      cached: false,
    });
  } catch (err) {
    console.error("keyword-clusters error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function formatStoredCluster(row: Record<string, unknown>): ClusterWithStats {
  return {
    cluster_name: row.cluster_name as string,
    keywords: row.keywords as string[],
    total_clicks: Number(row.total_clicks),
    total_impressions: Number(row.total_impressions),
    avg_position: Number(row.avg_position),
    content_suggestion: row.content_suggestion as string,
    priority: row.priority as string,
  };
}

function buildSummary(clusters: ClusterWithStats[]) {
  const totalClusters = clusters.length;
  const totalKeywords = clusters.reduce((sum, c) => sum + c.keywords.length, 0);
  const totalClicks = clusters.reduce((sum, c) => sum + c.total_clicks, 0);
  const totalImpressions = clusters.reduce((sum, c) => sum + c.total_impressions, 0);
  const highPriority = clusters.filter((c) => c.priority === "high").length;

  return {
    total_clusters: totalClusters,
    total_keywords: totalKeywords,
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    high_priority_clusters: highPriority,
  };
}
