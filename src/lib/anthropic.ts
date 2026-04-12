import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getOAuthToken(): Promise<string | null> {
  // Use cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 300_000) return cachedToken;

  try {
    const credsPath = join(homedir(), ".claude", ".credentials.json");
    const raw = readFileSync(credsPath, "utf8");
    const creds: ClaudeCredentials = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth) return null;

    // If token still valid, use it
    if (Date.now() < oauth.expiresAt - 300_000) {
      cachedToken = oauth.accessToken;
      tokenExpiresAt = oauth.expiresAt;
      return cachedToken;
    }

    // Refresh the token
    const res = await fetch("https://claude.ai/api/auth/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; expires_in: number };

    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;

    // Update credentials file
    oauth.accessToken = cachedToken;
    oauth.expiresAt = tokenExpiresAt;
    const { writeFileSync } = await import("fs");
    writeFileSync(credsPath, JSON.stringify(creds, null, 2));

    return cachedToken;
  } catch {
    return null;
  }
}

export async function getAnthropicClient(): Promise<Anthropic> {
  // Prefer explicit API key (Vercel / production)
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // Fallback: local Claude Code OAuth token
  const token = await getOAuthToken();
  if (token) {
    return new Anthropic({ apiKey: token });
  }

  throw new Error("No Anthropic credentials found. Set ANTHROPIC_API_KEY or run Claude Code locally.");
}
