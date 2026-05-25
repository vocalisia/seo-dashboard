// Unified AI client — Perplexity-first (web-grounded) → Anthropic → Mammouth fallback.
//
// Provider priority:
// 1. Perplexity Sonar (web search built-in, cheaper for SEO competitor research)
// 2. Anthropic Claude (high quality, no web search)
// 3. Mammouth OpenAI-compat (legacy, budget OUT since 2026-05-22)
//
// To enable Perplexity: set PERPLEXITY_API_KEY in Vercel env.
// Get key: https://www.perplexity.ai/settings/api (Pro subscription = $5/mo credit).

const PERPLEXITY_BASE = "https://api.perplexity.ai";
const MAMMOUTH_BASE = "https://api.mammouth.ai/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

// Perplexity Sonar models map
const PERPLEXITY_MODELS: Record<string, string> = {
  fast: "sonar",              // cheap, fast, web search included
  smart: "sonar-pro",         // higher quality
  cluster: "sonar",
  search: "sonar-pro",        // SEO research → best
  creative: "sonar-pro",
  haiku: "sonar",
  sonnet: "sonar-pro",
  opus: "sonar-reasoning",
};

// Anthropic-native model IDs (used when ANTHROPIC_API_KEY is set)
// Use latest stable snapshot IDs (no `-latest` to avoid silent drift)
export const MODELS = {
  // SEO task assignments
  fast:        "claude-haiku-4-5",     // briefs rapides → Haiku (rapide + pas cher)
  smart:       "claude-sonnet-4-6",    // rapports hebdo → Sonnet (qualité FR)
  cluster:     "claude-haiku-4-5",     // clustering mots clés
  search:      "claude-sonnet-4-6",    // ex-Perplexity → Sonnet (web grounding via tool)
  creative:    "claude-sonnet-4-6",    // rédaction créative

  // Direct aliases (latest stable snapshots per Anthropic API)
  haiku:       "claude-haiku-4-5",
  sonnet:      "claude-sonnet-4-6",
  opus:        "claude-opus-4-7",
};

// Structured error class so API routes can surface the real reason.
// Keeps backwards compatibility with `instanceof Error` checks.
export class AIProviderError extends Error {
  public readonly provider: "perplexity" | "anthropic" | "mammouth" | "none";
  public readonly code: "no_key" | "credit_low" | "rate_limit" | "auth" | "model" | "network" | "unknown";
  public readonly status?: number;

  constructor(
    message: string,
    opts: { provider: "perplexity" | "anthropic" | "mammouth" | "none"; code: AIProviderError["code"]; status?: number }
  ) {
    super(message);
    this.name = "AIProviderError";
    this.provider = opts.provider;
    this.code = opts.code;
    this.status = opts.status;
  }
}

interface Message { role: "user" | "assistant" | "system"; content: string; }

export async function askAI(
  messages: Message[],
  model: keyof typeof MODELS = "fast",
  maxTokens = 1500
): Promise<string> {
  const modelId = MODELS[model];
  const pplxKey = process.env.PERPLEXITY_API_KEY;
  const anthKey = process.env.ANTHROPIC_API_KEY;

  // Primary path: Perplexity Sonar (web-grounded, cheaper for SEO research)
  if (pplxKey) {
    try {
      const pplxModel = PERPLEXITY_MODELS[model] ?? "sonar";
      return await callPerplexity(pplxKey, pplxModel, messages, maxTokens);
    } catch (err) {
      // Fall through on credit/auth issues; surface other errors
      if (!(err instanceof AIProviderError) || (err.code !== "credit_low" && err.code !== "auth" && err.code !== "no_key")) {
        throw err;
      }
      // Continue to next provider on key/budget issues
    }
  }

  // Fallback 1: Anthropic native
  if (anthKey) {
    try {
      return await callAnthropicNative(anthKey, modelId, messages, maxTokens);
    } catch (err) {
      // Only fall through to Mammouth on credit/quota issues — auth/network errors should surface.
      if (err instanceof AIProviderError && err.code === "credit_low") {
        const mammKey = process.env.MAMMOUTH_API_KEY;
        if (mammKey) {
          try {
            return await callOpenAICompat(MAMMOUTH_BASE, mammKey, modelId, messages, maxTokens);
          } catch {
            throw err;
          }
        }
      }
      throw err;
    }
  }

  // Fallback 2: Mammouth (OpenAI-compat) — budget OUT since 2026-05-22, kept only if explicitly set.
  const mammKey = process.env.MAMMOUTH_API_KEY;
  if (mammKey) {
    return callOpenAICompat(MAMMOUTH_BASE, mammKey, modelId, messages, maxTokens);
  }

  // Fallback 3: local Claude Code OAuth token (dev only)
  const localToken = await getLocalOAuthToken();
  if (localToken) {
    return callAnthropicNative(localToken, modelId, messages, maxTokens, true);
  }

  throw new AIProviderError(
    "No AI API key configured. Set PERPLEXITY_API_KEY (preferred) or ANTHROPIC_API_KEY in Vercel env.",
    { provider: "none", code: "no_key" }
  );
}

// Perplexity Sonar API (OpenAI-compatible chat completions endpoint, web-grounded)
async function callPerplexity(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number
): Promise<string> {
  const res = await fetch(`${PERPLEXITY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    let code: AIProviderError["code"] = "unknown";
    let userMsg = `Perplexity API error ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      code = "auth";
      userMsg = "Perplexity auth failed — vérifie PERPLEXITY_API_KEY";
    } else if (res.status === 429) {
      code = "rate_limit";
      userMsg = "Perplexity rate limit — réessaie dans quelques secondes";
    } else if (res.status === 400 && /ExceededBudget|budget|insufficient|quota/i.test(err)) {
      code = "credit_low";
      userMsg = "Crédit Perplexity épuisé — recharge sur perplexity.ai/settings/api";
    } else if (res.status === 404 && /model/i.test(err)) {
      code = "model";
      userMsg = `Modèle Perplexity inconnu: ${model}`;
    } else if (res.status >= 500) {
      code = "network";
      userMsg = `Perplexity indisponible (${res.status}) — réessaie`;
    }
    throw new AIProviderError(userMsg, { provider: "perplexity", code, status: res.status });
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
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
    let code: AIProviderError["code"] = "unknown";
    let userMsg = `Anthropic API error ${res.status}`;

    if (res.status === 401 || res.status === 403) {
      code = "auth";
      userMsg = "Anthropic auth failed — vérifie la clé ANTHROPIC_API_KEY";
    } else if (res.status === 429) {
      code = "rate_limit";
      userMsg = "Anthropic rate limit — réessaie dans quelques secondes";
    } else if (res.status === 400 && /credit balance is too low/i.test(err)) {
      code = "credit_low";
      userMsg = "Crédit Anthropic épuisé — recharge sur console.anthropic.com/billing";
    } else if (res.status === 404 && /model/i.test(err)) {
      code = "model";
      userMsg = `Modèle Anthropic inconnu: ${model}`;
    } else if (res.status >= 500) {
      code = "network";
      userMsg = `Anthropic indisponible (${res.status}) — réessaie`;
    }

    throw new AIProviderError(userMsg, { provider: "anthropic", code, status: res.status });
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
    let code: AIProviderError["code"] = "unknown";
    if (res.status === 401 || res.status === 403) code = "auth";
    else if (res.status === 429) code = "rate_limit";
    else if (res.status === 402 || /insufficient|budget|quota|credit/i.test(err)) code = "credit_low";
    throw new AIProviderError(
      `Mammouth API error ${res.status}: ${err.slice(0, 200)}`,
      { provider: "mammouth", code, status: res.status }
    );
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
