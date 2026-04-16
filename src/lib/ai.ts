// Unified AI client — uses Mammouth (priority) or Anthropic OAuth fallback
// Mammouth is OpenAI-compatible: https://api.mammouth.ai/v1

const MAMMOUTH_BASE = "https://api.mammouth.ai/v1";

// Model aliases — Mammouth supports all of these
export const MODELS = {
  // Tâches SEO assignées
  fast:        "gemini-2.5-flash",            // briefs rapides → Gemini Flash
  smart:       "claude-sonnet-4-6",           // rapports hebdo → Sonnet (meilleur FR)
  cluster:     "gemini-2.5-flash",            // clustering mots clés → stable via Mammouth
  search:      "sonar-pro",                    // recherche SERP temps réel → Perplexity
  creative:    "mistral-large-latest",        // rédaction créative → Mistral

  // Tous les modèles dispo
  haiku:       "claude-haiku-4-5-20251001",
  sonnet:      "claude-sonnet-4-6",
  opus:        "claude-opus-4-6",
  geminiFlash: "gemini-2.5-flash",
  geminiPro:   "gemini-3-pro-image-preview",
  gpt4o:       "gpt-4o",
  gpt5:        "gpt-5",
  deepseek:    "deepseek-v3",
  mistral:     "mistral-large-latest",
  magistral:   "magistral-medium-latest",
  perplexity:  "sonar-pro",                    // web search intégré
  llama:       "meta-llama/llama-4-maverick",
  grok:        "grok-3",
};

interface Message { role: "user" | "assistant" | "system"; content: string; }

export async function askAI(
  messages: Message[],
  model: keyof typeof MODELS = "fast",
  maxTokens = 1500
): Promise<string> {
  const apiKey = process.env.MAMMOUTH_API_KEY || process.env.ANTHROPIC_API_KEY;
  const baseUrl = process.env.MAMMOUTH_API_KEY ? MAMMOUTH_BASE : "https://api.anthropic.com/v1";

  if (!apiKey) {
    // Last resort: try local Claude Code OAuth token
    const localToken = await getLocalOAuthToken();
    if (!localToken) throw new Error("No AI API key configured");
    return callOpenAICompat("https://api.anthropic.com/v1", localToken, MODELS[model], messages, maxTokens);
  }

  return callOpenAICompat(baseUrl, apiKey, MODELS[model], messages, maxTokens);
}

// Generate image via DALL-E 3 (OpenAI) — reliable, hosted URL
export async function generateImage(prompt: string): Promise<string | null> {
  // Try OpenAI DALL-E 3 first (most reliable for hosted URLs)
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
        const url = data.data?.[0]?.url;
        if (url) return url;
      }
    } catch {
      // fall through to Mammouth
    }
  }

  // Fallback: Mammouth Gemini image via chat completions
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
        if (urlMatch) return urlMatch[0];
      }
    } catch {
      // no image
    }
  }

  return null;
}

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
    if (Date.now() > expiresAt - 300_000) return null; // expired
    return token;
  } catch {
    return null;
  }
}
