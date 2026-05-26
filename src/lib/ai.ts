// Unified AI client — Perplexity-first (web-grounded) → Anthropic → graceful fail.
// Mammouth removed 2026-05-26 (budget OUT since 2026-05-22).
//
// Provider priority:
// 1. Perplexity Sonar (web search built-in, cheap for SEO competitor research)
//    Set PERPLEXITY_API_KEY in Vercel env. Get key: https://www.perplexity.ai/settings/api
//    Pro subscription = $5/mo credit (~5000 sonar queries).
// 2. Anthropic Claude (high quality, no web search)
//    Set ANTHROPIC_API_KEY in Vercel env.
// 3. Local Claude Code OAuth (dev only).
//
// When NO provider available → throws AIProviderError(no_key) so caller can
// fall back to cache or stub data (no "Crédit épuisé" raw error to users).

const PERPLEXITY_BASE = "https://api.perplexity.ai";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

// Anthropic-native model IDs (used when ANTHROPIC_API_KEY is set)
export const MODELS = {
  // SEO task assignments
  fast:        "claude-haiku-4-5",     // briefs rapides
  smart:       "claude-sonnet-4-6",    // rapports hebdo
  cluster:     "claude-haiku-4-5",     // clustering mots-clés
  search:      "claude-sonnet-4-6",    // web grounding
  creative:    "claude-sonnet-4-6",    // rédaction créative
  // Direct aliases
  haiku:       "claude-haiku-4-5",
  sonnet:      "claude-sonnet-4-6",
  opus:        "claude-opus-4-7",
};

// Perplexity Sonar models map (OpenAI-compatible)
const PERPLEXITY_MODELS: Record<string, string> = {
  fast: "sonar",
  smart: "sonar-pro",
  cluster: "sonar",
  search: "sonar-pro",
  creative: "sonar-pro",
  haiku: "sonar",
  sonnet: "sonar-pro",
  opus: "sonar-reasoning",
};

export class AIProviderError extends Error {
  public readonly provider: "perplexity" | "anthropic" | "none";
  public readonly code: "no_key" | "credit_low" | "rate_limit" | "auth" | "model" | "network" | "unknown";
  public readonly status?: number;

  constructor(
    message: string,
    opts: { provider: "perplexity" | "anthropic" | "none"; code: AIProviderError["code"]; status?: number }
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
      // Continue to next provider
    }
  }

  // Fallback 1: Anthropic native
  if (anthKey) {
    return callAnthropicNative(anthKey, modelId, messages, maxTokens);
  }

  // Fallback 2: local Claude Code OAuth token (dev only)
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

// Generate image — DALL-E 3 then Pollinations Flux fallback (free, no key)
export async function generateImage(prompt: string): Promise<string | null> {
  let tempUrl: string | null = null;

  // Primary: OpenAI DALL-E 3
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

  // Fallback: Pollinations.ai Flux (free, no auth)
  if (!tempUrl) {
    try {
      const seed = Math.floor(Math.random() * 100000);
      const encoded = encodeURIComponent(prompt);
      const url = `https://image.pollinations.ai/prompt/${encoded}?width=1536&height=1024&model=flux&seed=${seed}&nologo=true`;
      const res = await fetch(url);
      if (res.ok) {
        tempUrl = url;
      }
    } catch {
      // no image
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

// Local Claude Code OAuth token (dev fallback)
async function getLocalOAuthToken(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");
    const credPath = path.join(os.homedir(), ".claude", "credentials.json");
    const raw = await fs.readFile(credPath, "utf8");
    const data = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
    return data.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
