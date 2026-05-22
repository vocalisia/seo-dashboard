// Unified AI client — Anthropic-first (Sonnet/Haiku/Opus) with Mammouth OpenAI-compat fallback.
// Mammouth budget exceeded 2026-05-22 → primary path is now Anthropic native API.

const MAMMOUTH_BASE = "https://api.mammouth.ai/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

// Anthropic-native model IDs (used when ANTHROPIC_API_KEY is set)
// Mammouth IDs are aliased for fallback path
export const MODELS = {
  // SEO task assignments
  fast:        "claude-haiku-4-5",     // briefs rapides → Haiku (rapide + pas cher)
  smart:       "claude-sonnet-4-6",    // rapports hebdo → Sonnet (qualité FR)
  cluster:     "claude-haiku-4-5",     // clustering mots clés
  search:      "claude-sonnet-4-6",    // ex-Perplexity (budget out) → Sonnet
  creative:    "claude-sonnet-4-6",    // rédaction créative

  // Direct aliases
  haiku:       "claude-haiku-4-5",
  sonnet:      "claude-sonnet-4-6",
  opus:        "claude-opus-4-6",
};

interface Message { role: "user" | "assistant" | "system"; content: string; }

export async function askAI(
  messages: Message[],
  model: keyof typeof MODELS = "fast",
  maxTokens = 1500
): Promise<string> {
  const modelId = MODELS[model];
  const anthKey = process.env.ANTHROPIC_API_KEY;

  // Primary path: Anthropic native
  if (anthKey) {
    return callAnthropicNative(anthKey, modelId, messages, maxTokens);
  }

  // Fallback 1: Mammouth (OpenAI-compat) — budget likely out but kept for resilience
  const mammKey = process.env.MAMMOUTH_API_KEY;
  if (mammKey) {
    return callOpenAICompat(MAMMOUTH_BASE, mammKey, modelId, messages, maxTokens);
  }

  // Fallback 2: local Claude Code OAuth token (dev only)
  const localToken = await getLocalOAuthToken();
  if (localToken) {
    return callAnthropicNative(localToken, modelId, messages, maxTokens, true);
  }

  throw new Error("No AI API key configured (ANTHROPIC_API_KEY or MAMMOUTH_API_KEY)");
}

// Generate image via DALL-E 3 (OpenAI) then persist to Vercel Blob (permanent URL)
export async function generateImage(prompt: string): Promise<string | null> {
  let tempUrl: string | null = null;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: "1792x1024" }),
      });
      if (res.ok) {
        const data = await res.json() as { data: { url: string }[] };
        tempUrl = data.data?.[0]?.url ?? null;
      }
    } catch {
      // fall through
    }
  }

  // Fallback: Mammouth Gemini image (if still configured)
  if (!tempUrl) {
    const mammouthKey = process.env.MAMMOUTH_API_KEY;
    if (mammouthKey) {
      try {
        const res = await fetch(`${MAMMOUTH_BASE}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${mammouthKey}` },
          body: JSON.stringify({
            model: "gemini-3-pro-image-preview",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 512,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { choices: { message: { content: string } }[] };
          const content = data.choices?.[0]?.message?.content ?? "";
          const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp)/i);
          if (urlMatch) tempUrl = urlMatch[0];
        }
      } catch {
        // no image
      }
    }
  }

  if (!tempUrl) return null;

  // Persist to Vercel Blob for permanent URL
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const imgRes = await fetch(tempUrl);
      if (imgRes.ok) {
        const blob = await imgRes.blob();
        const filename = `autopilot/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        const { url: permanentUrl } = await put(filename, blob, { access: "public" });
        return permanentUrl;
      }
    } catch (err) {
      console.error("[generateImage] Blob upload failed, using temp URL:", err);
    }
  }

  return tempUrl;
}

// Anthropic native API: /v1/messages with x-api-key header (or Bearer for OAuth)
async function callAnthropicNative(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  useBearer = false
): Promise<string> {
  // Anthropic requires system separated from messages
  const systemMsg = messages.find(m => m.role === "system")?.content ?? "";
  const userMsgs = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (useBearer) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: userMsgs,
  };
  if (systemMsg) body.system = systemMsg;

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as { content: { type: string; text: string }[] };
  return data.content?.find(c => c.type === "text")?.text ?? "";
}

// Legacy OpenAI-compatible call (used by Mammouth fallback only)
async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

async function getLocalOAuthToken(): Promise<string | null> {
  try {
    const { readFileSync } = await import("fs");
    const { homedir } = await import("os");
    const { join } = await import("path");
    const raw = readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8");
    const creds = JSON.parse(raw);
    const token = creds.claudeAiOauth?.accessToken;
    if (!token) return null;
    const expiresAt = creds.claudeAiOauth?.expiresAt ?? 0;
    if (Date.now() > expiresAt - 300_000) return null;
    return token;
  } catch {
    return null;
  }
}
