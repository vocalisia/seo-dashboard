import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function requireApiSession() {
  try {
    const session = await auth();
    if (session?.user) {
      return { session, unauthorized: null as NextResponse | null };
    }
  } catch {
    // fall through to dev/prod handling
  }

  if (process.env.NODE_ENV === "development") {
    return { session: null, unauthorized: null as NextResponse | null };
  }

  return {
    session: null,
    unauthorized: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
  };
}
