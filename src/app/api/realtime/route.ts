import { auth } from "@/auth";
import { getAnalyticsClient } from "@/lib/google-auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const propertyId = request.nextUrl.searchParams.get("propertyId");

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId requis" }, { status: 400 });
  }

  try {
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const analytics = getAnalyticsClient(session.accessToken);

    const response = await analytics.properties.runRealtimeReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dimensions: [
          { name: "country" },
          { name: "deviceCategory" },
          { name: "unifiedScreenName" },
        ],
        metrics: [{ name: "activeUsers" }],
      },
    });

    const rows = response.data.rows || [];
    const totalActive = rows.reduce((sum, row) => {
      return sum + parseInt(row.metricValues?.[0]?.value || "0");
    }, 0);

    const byCountry: Record<string, number> = {};
    const byDevice: Record<string, number> = {};
    const byPage: Record<string, number> = {};

    for (const row of rows) {
      const country = row.dimensionValues?.[0]?.value || "Unknown";
      const device = row.dimensionValues?.[1]?.value || "Unknown";
      const page = row.dimensionValues?.[2]?.value || "/";
      const users = parseInt(row.metricValues?.[0]?.value || "0");

      byCountry[country] = (byCountry[country] || 0) + users;
      byDevice[device] = (byDevice[device] || 0) + users;
      byPage[page] = (byPage[page] || 0) + users;
    }

    return NextResponse.json({
      totalActive,
      byCountry: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10),
      byDevice: Object.entries(byDevice).sort((a, b) => b[1] - a[1]),
      byPage: Object.entries(byPage).sort((a, b) => b[1] - a[1]).slice(0, 10),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
