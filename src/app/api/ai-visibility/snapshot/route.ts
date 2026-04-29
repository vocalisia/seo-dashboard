export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { z } from "zod";

const BodySchema = z.object({
  siteId: z.number().int().positive(),
  score: z.number().min(0).max(100),
  results: z.array(z.unknown()),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 }
    );
  }

  const { siteId, score, results } = parsed.data;
  const sql = getSQL();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id),
        score FLOAT NOT NULL,
        results JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      INSERT INTO ai_visibility_snapshots (site_id, score, results)
      VALUES (${siteId}, ${score}, ${JSON.stringify(results)})
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
