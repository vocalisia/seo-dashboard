import { NextResponse } from "next/server";

// Stub – log parsing is done client-side via FileReader API
export async function GET() {
  return NextResponse.json({ ok: true });
}
