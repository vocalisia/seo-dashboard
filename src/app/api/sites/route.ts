import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// Language → target countries (ISO-3)
const LANG_COUNTRIES: Record<string, string[]> = {
  fr: ["FRA","BEL","CHE","LUX","MCO","CAN"],
  en: ["GBR","USA","IRL","AUS","NZL","CAN"],
  de: ["DEU","AUT","CHE","LIE"],
  es: ["ESP","MEX","ARG","COL","CHL","PER"],
  it: ["ITA","CHE","SMR","VAT"],
  nl: ["NLD","BEL"],
  pt: ["PRT","BRA","AGO","MOZ"],
};

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error: "missing_env",
        message:
          "DATABASE_URL est absent ou vide dans .env.local. Restaure les secrets (ex. npx vercel env pull .env.local) puis redémarre npm run dev.",
      },
      { status: 503 }
    );
  }

  const language = request.nextUrl.searchParams.get("language");
  const countryFilter = language && LANG_COUNTRIES[language] ? LANG_COUNTRIES[language] : null;

  try {
    const sql = getSQL();

    const rows = countryFilter
      ? await sql`
          SELECT
            s.*,
            COALESCE(a.total_sessions, 0) as total_sessions_30d,
            COALESCE(a.total_users, 0) as total_users_30d,
            COALESCE(a.total_pageviews, 0) as total_pageviews_30d,
            COALESCE(a.total_organic, 0) as organic_sessions_30d,
            COALESCE(gsc.total_clicks, 0) as gsc_clicks_30d,
            COALESCE(gsc.total_impressions, 0) as gsc_impressions_30d,
            COALESCE(gsc.avg_position, 0) as avg_position_30d
          FROM sites s
          LEFT JOIN (
            SELECT site_id,
              SUM(sessions) as total_sessions,
              SUM(users) as total_users,
              SUM(pageviews) as total_pageviews,
              SUM(organic_sessions) as total_organic
            FROM analytics_daily
            WHERE date >= NOW() - INTERVAL '30 days'
            GROUP BY site_id
          ) a ON a.site_id = s.id
          LEFT JOIN (
            SELECT site_id,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(NULLIF(position, 0)) as avg_position
            FROM search_console_data
            WHERE date >= NOW() - INTERVAL '30 days'
              AND country = ANY(${countryFilter})
            GROUP BY site_id
          ) gsc ON gsc.site_id = s.id
          WHERE s.is_active = true
          ORDER BY s.name
        `
      : await sql`
          SELECT
            s.*,
            COALESCE(a.total_sessions, 0) as total_sessions_30d,
            COALESCE(a.total_users, 0) as total_users_30d,
            COALESCE(a.total_pageviews, 0) as total_pageviews_30d,
            COALESCE(a.total_organic, 0) as organic_sessions_30d,
            COALESCE(gsc.total_clicks, 0) as gsc_clicks_30d,
            COALESCE(gsc.total_impressions, 0) as gsc_impressions_30d,
            COALESCE(gsc.avg_position, 0) as avg_position_30d
          FROM sites s
          LEFT JOIN (
            SELECT site_id,
              SUM(sessions) as total_sessions,
              SUM(users) as total_users,
              SUM(pageviews) as total_pageviews,
              SUM(organic_sessions) as total_organic
            FROM analytics_daily
            WHERE date >= NOW() - INTERVAL '30 days'
            GROUP BY site_id
          ) a ON a.site_id = s.id
          LEFT JOIN (
            SELECT site_id,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(NULLIF(position, 0)) as avg_position
            FROM search_console_data
            WHERE date >= NOW() - INTERVAL '30 days'
            GROUP BY site_id
          ) gsc ON gsc.site_id = s.id
          WHERE s.is_active = true
          ORDER BY s.name
        `;

    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSQL();
    const { name, url, ga_property_id, gsc_property } = await request.json();
    const rows = await sql`
      INSERT INTO sites (name, url, ga_property_id, gsc_property)
      VALUES (${name}, ${url}, ${ga_property_id}, ${gsc_property})
      RETURNING *
    `;
    return NextResponse.json(rows[0]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
