import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

function isLocalhostHost(host: string): boolean {
  let hostname = host.trim().toLowerCase();
  if (hostname.startsWith("[")) {
    const closingBracket = hostname.indexOf("]");
    hostname = closingBracket >= 0 ? hostname.slice(1, closingBracket) : hostname;
  } else {
    hostname = hostname.split(":")[0];
  }
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function requireApiSession() {
  try {
    const session = await auth();
    if (session?.user) {
      return { session, unauthorized: null as NextResponse | null };
    }
  } catch {
    // fall through to dev/prod handling
  }

  const host = (await headers()).get("host") ?? "";
  const authUrl = process.env.NEXTAUTH_URL ?? "";
  const localAuthUrl = authUrl.includes("localhost") || authUrl.includes("127.0.0.1");
  const isLocalRuntime =
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_DEV_BYPASS_AUTH === "true" &&
    (isLocalhostHost(host) || localAuthUrl);

  if (isLocalRuntime) {
    return { session: null, unauthorized: null as NextResponse | null };
  }

  return {
    session: null,
    unauthorized: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
  };
}
