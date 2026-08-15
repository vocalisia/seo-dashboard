import { initDB } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";

export async function POST() {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    await initDB();
    return NextResponse.json({ success: true, message: "Database initialized" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
