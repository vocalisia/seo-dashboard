import { initDB } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    await initDB();
    return NextResponse.json({ success: true, message: "Database initialized" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
