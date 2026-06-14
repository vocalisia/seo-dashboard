import { logError } from "./logger";
import { google } from "googleapis";

// Unified AI client: Gemini/Vertex first for normal work, Perplexity first for
// web-grounded search, then graceful cache/local fallbacks.
// Mammouth removed 2026-05-26.
//
// Provider priority:
// 1. Gemini via GEMINI_API_KEY/GOOGLE_API_KEY or Google service account + Vertex.
// 2. Perplexity Sonar for live SERP/search tasks when PERPLEXITY_API_KEY exists.
// 3. OpenAI / Anthropic fallbacks when configured in Vercel.
// 4. Mammouth fallback when MAMMOUTH_API_KEY exists.
// 5. Cache/local fallbacks handled by callers when all providers are unavailable.
//
// When NO provider available → throws AIProviderError(no_key) so caller can
// fall back to cache or stub data (no "Crédit épuisé" raw error to users).

const PERPLEXITY_BASE = "https://api.perplexity.ai";
const GEMINI_DEVELOPER_BASE = "https://generativelanguage.googleapis.com/v1beta";
const VERTEX_BASE = "https://aiplatform.googleapis.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const MAMMOUTH_BASE = "https://api.mammouth.ai/v1";

export const MODELS = {
  // SEO task assignments
  fast:        "fast",
  smart:       "smart",
  cluster:     "cluster",
  search:      "search",
  creative:    "creative",
  // Direct aliases
  haiku:       "fast",
  sonnet:      "smart",
  opus:        "creative",
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

const GEMINI_MODELS: Record<keyof typeof MODELS, string> = {
  fast: "gemini-3.1-flash-lite-preview",
  smart: "gemini-3-flash-preview",
  cluster: "gemini-3.1-flash-lite-preview",
  search: "gemini-3-flash-preview",
  creative: "gemini-3-flash-preview",
  haiku: "gemini-3.1-flash-lite-preview",
  sonnet: "gemini-3-flash-preview",
  opus: "gemini-3.1-pro-preview",
};

export class AIProviderError extends Error {
  public readonly provider: "gemini" | "perplexity" | "openai" | "anthropic" | "mammouth" | "none";
  public readonly code: "no_key" | "credit_low" | "rate_limit" | "auth" | "model" | "network" | "unknown";
  public readonly status?: number;

  constructor(
    message: string,
    opts: { provider: AIProviderError["provider"]; code: AIProviderError["code"]; status?: number }
  ) {
    super(message);
    this.name = "AIProviderError";
    this.provider = opts.provider;
    this.code = opts.code;
    this.status = opts.status;
  }
}

interface Message { role: "user" | "assistant" | "system"; content: string; }

function cleanEnvValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\r|\n|\\r|\\n/g, "").trim();
  return cleaned || undefined;
}

function readEnv(name: string): string | undefined {
  return cleanEnvValue(process.env[name]);
}

function readRawEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseGoogleCredentials(): { project_id?: string; client_email?: string; private_key?: string } | null {
  const raw = readRawEnv("GOOGLE_CREDENTIALS") || readRawEnv("GSC_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/\n/g, "\\n").replace(/\\\\n/g, "\\n"));
  } catch {
    try {
      return JSON.parse(raw.replace(/[\x00-\x1F\x7F]/g, (c) => (c === "\n" || c === "\r" || c === "\t" ? c : "")));
    } catch {
      return null;
    }
  }
}

function getGeminiApiKey(): string | undefined {
  return readEnv("GEMINI_API_KEY") || readEnv("GOOGLE_API_KEY");
}

function getOpenAIKey(): string | undefined {
  return readEnv("OPENAI_API_KEY");
}

function getAnthropicKey(): string | undefined {
  return readEnv("ANTHROPIC_API_KEY");
}

function getMammouthKey(): string | undefined {
  return readEnv("MAMMOUTH_API_KEY") || readEnv("MAMMOUTH_KEY");
}

function getVertexProjectId(): string | undefined {
  return readEnv("GOOGLE_CLOUD_PROJECT") || parseGoogleCredentials()?.project_id;
}

function hasGeminiConfig(): boolean {
  return Boolean(getGeminiApiKey() || getVertexProjectId());
}

function shouldTryPerplexityFirst(model: keyof typeof MODELS): boolean {
  return model === "search";
}

function canTryNextProvider(err: AIProviderError): boolean {
  return ["credit_low", "auth", "no_key", "model", "network", "rate_limit"].includes(err.code);
}

export async function askAI(
  messages: Message[],
  model: keyof typeof MODELS = "fast",
  maxTokens = 1500
): Promise<string> {
  const geminiModel = GEMINI_MODELS[model] ?? GEMINI_MODELS.fast;
  const pplxKey = readEnv("PERPLEXITY_API_KEY");
  const tryPerplexityFirst = shouldTryPerplexityFirst(model);

  if (tryPerplexityFirst && pplxKey) {
    try {
      const pplxModel = PERPLEXITY_MODELS[model] ?? "sonar";
      return await callPerplexity(pplxKey, pplxModel, messages, maxTokens);
    } catch (err) {
      if (!(err instanceof AIProviderError) || !canTryNextProvider(err)) {
        throw err;
      }
    }
  }

  if (hasGeminiConfig()) {
    try {
      return await callGemini(geminiModel, messages, maxTokens);
    } catch (err) {
      if (!(err instanceof AIProviderError) || !canTryNextProvider(err)) {
        throw err;
      }
    }
  }

  if (!tryPerplexityFirst && pplxKey) {
    try {
      const pplxModel = PERPLEXITY_MODELS[model] ?? "sonar";
      return await callPerplexity(pplxKey, pplxModel, messages, maxTokens);
    } catch (err) {
      if (!(err instanceof AIProviderError) || !canTryNextProvider(err)) {
        throw err;
      }
    }
  }

  const openAIKey = getOpenAIKey();
  if (openAIKey) {
    try {
      return await callOpenAI(openAIKey, messages, maxTokens);
    } catch (err) {
      if (!(err instanceof AIProviderError) || !canTryNextProvider(err)) {
        throw err;
      }
    }
  }

  const anthropicKey = getAnthropicKey();
  if (anthropicKey) {
    try {
      return await callAnthropic(anthropicKey, messages, maxTokens);
    } catch (err) {
      if (!(err instanceof AIProviderError) || !canTryNextProvider(err)) {
        throw err;
      }
    }
  }

  const mammouthKey = getMammouthKey();
  if (mammouthKey) {
    try {
      return await callMammouth(mammouthKey, messages, maxTokens);
    } catch (err) {
      if (!(err instanceof AIProviderError) || !canTryNextProvider(err)) {
        throw err;
      }
    }
  }

  throw new AIProviderError(
    "No AI provider configured. Set GEMINI_API_KEY/GOOGLE_API_KEY, GOOGLE_CLOUD_PROJECT with service account credentials, PERPLEXITY_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or MAMMOUTH_API_KEY.",
    { provider: "none", code: "no_key" }
  );
}

function toGeminiContents(messages: Message[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
} {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: message.content }],
    }));

  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "" }] }],
  };
}

function readGeminiText(data: unknown): string {
  const response = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim() ?? "";
}

async function getVertexAccessToken(): Promise<string> {
  const creds = parseGoogleCredentials();
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds
        ? {
            client_email: creds.client_email,
            private_key: creds.private_key,
          }
        : undefined,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const token = await auth.getAccessToken();
    if (!token) {
      throw new AIProviderError("Gemini Vertex auth failed: no access token", { provider: "gemini", code: "auth" });
    }
    return token;
  } catch (err) {
    if (err instanceof AIProviderError) throw err;
    throw new AIProviderError("Gemini Vertex auth failed. Falling back to another AI provider.", {
      provider: "gemini",
      code: "auth",
    });
  }
}

async function callGemini(model: string, messages: Message[], maxTokens: number): Promise<string> {
  const payload = {
    ...toGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.2,
    },
  };

  const apiKey = getGeminiApiKey();
  const projectId = getVertexProjectId();
  const location = readEnv("GOOGLE_CLOUD_LOCATION") || "global";
  const endpoint = apiKey
    ? `${GEMINI_DEVELOPER_BASE}/models/${model}:generateContent`
    : `${VERTEX_BASE}/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  if (!apiKey && !projectId) {
    throw new AIProviderError("Gemini is not configured", { provider: "gemini", code: "no_key" });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${await getVertexAccessToken()}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    let code: AIProviderError["code"] = "unknown";
    let userMsg = `Gemini API error ${res.status}`;

    if (res.status === 401 || res.status === 403) {
      code = "auth";
      userMsg = "Gemini auth failed. Check Gemini API key or Google service account permissions.";
    } else if (res.status === 429) {
      code = "rate_limit";
      userMsg = "Gemini rate limit. Try again later or use cached data.";
    } else if (res.status === 400 && /quota|budget|billing|insufficient/i.test(err)) {
      code = "credit_low";
      userMsg = "Gemini quota unavailable. The dashboard will use cache or local fallbacks.";
    } else if (res.status === 404 && /model/i.test(err)) {
      code = "model";
      userMsg = `Gemini model unavailable: ${model}`;
    } else if (res.status >= 500) {
      code = "network";
      userMsg = `Gemini unavailable (${res.status}). Try again later.`;
    }

    throw new AIProviderError(userMsg, { provider: "gemini", code, status: res.status });
  }

  const text = readGeminiText(await res.json());
  if (!text) {
    throw new AIProviderError("Gemini returned an empty response", { provider: "gemini", code: "unknown" });
  }
  return text;
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

async function callOpenAI(apiKey: string, messages: Message[], maxTokens: number): Promise<string> {
  const model = readEnv("OPENAI_MODEL") || "gpt-4o-mini";
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
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
    let userMsg = `OpenAI API error ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      code = "auth";
      userMsg = "OpenAI auth failed. Check OPENAI_API_KEY.";
    } else if (res.status === 429) {
      code = /quota|billing|insufficient/i.test(err) ? "credit_low" : "rate_limit";
      userMsg = code === "credit_low" ? "OpenAI quota unavailable." : "OpenAI rate limit. Try again later.";
    } else if (res.status === 404 && /model/i.test(err)) {
      code = "model";
      userMsg = `OpenAI model unavailable: ${model}`;
    } else if (res.status >= 500) {
      code = "network";
      userMsg = `OpenAI unavailable (${res.status}). Try again later.`;
    }
    throw new AIProviderError(userMsg, { provider: "openai", code, status: res.status });
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new AIProviderError("OpenAI returned an empty response", { provider: "openai", code: "unknown" });
  }
  return text;
}

async function callAnthropic(apiKey: string, messages: Message[], maxTokens: number): Promise<string> {
  const model = readEnv("ANTHROPIC_MODEL") || "claude-3-5-haiku-latest";
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();
  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      ...(system ? { system } : {}),
      messages: anthropicMessages.length > 0 ? anthropicMessages : [{ role: "user", content: "" }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    let code: AIProviderError["code"] = "unknown";
    let userMsg = `Anthropic API error ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      code = "auth";
      userMsg = "Anthropic auth failed. Check ANTHROPIC_API_KEY.";
    } else if (res.status === 429) {
      code = /credit|quota|billing/i.test(err) ? "credit_low" : "rate_limit";
      userMsg = code === "credit_low" ? "Anthropic quota unavailable." : "Anthropic rate limit. Try again later.";
    } else if (res.status === 404 && /model/i.test(err)) {
      code = "model";
      userMsg = `Anthropic model unavailable: ${model}`;
    } else if (res.status >= 500) {
      code = "network";
      userMsg = `Anthropic unavailable (${res.status}). Try again later.`;
    }
    throw new AIProviderError(userMsg, { provider: "anthropic", code, status: res.status });
  }

  const data = await res.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = data.content?.map((part) => part.text ?? "").join("").trim() ?? "";
  if (!text) {
    throw new AIProviderError("Anthropic returned an empty response", { provider: "anthropic", code: "unknown" });
  }
  return text;
}

async function callMammouth(apiKey: string, messages: Message[], maxTokens: number): Promise<string> {
  const preferredModel = readEnv("MAMMOUTH_MODEL");
  const models = [
    preferredModel,
    "gpt-5.4",
    "Codex-opus-4-6",
    "gemini-3.1-pro-preview",
  ].filter((model, index, arr): model is string => Boolean(model) && arr.indexOf(model) === index);

  let lastError: AIProviderError | null = null;
  for (const model of models) {
    const res = await fetch(`${MAMMOUTH_BASE}/chat/completions`, {
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
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      let code: AIProviderError["code"] = "unknown";
      let userMsg = `Mammouth API error ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        code = "auth";
        userMsg = "Mammouth auth failed. Check MAMMOUTH_API_KEY.";
      } else if (res.status === 429) {
        code = /credit|quota|billing|insufficient/i.test(err) ? "credit_low" : "rate_limit";
        userMsg = code === "credit_low" ? "Mammouth quota unavailable." : "Mammouth rate limit. Try again later.";
      } else if (res.status === 400 || (res.status === 404 && /model/i.test(err))) {
        code = "model";
        userMsg = `Mammouth model unavailable: ${model}`;
      } else if (res.status >= 500) {
        code = "network";
        userMsg = `Mammouth unavailable (${res.status}). Try again later.`;
      }
      lastError = new AIProviderError(userMsg, { provider: "mammouth", code, status: res.status });
      if (code === "model" || code === "network" || code === "rate_limit") continue;
      throw lastError;
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (text) return text;
    lastError = new AIProviderError("Mammouth returned an empty response", { provider: "mammouth", code: "unknown" });
  }

  throw lastError ?? new AIProviderError("Mammouth returned no usable response", { provider: "mammouth", code: "unknown" });
}

// Generate image: Gemini first, then free Pollinations. No OpenAI fallback.
export async function generateImage(prompt: string): Promise<string | null> {
  let tempUrl: string | null = null;

  if (hasGeminiConfig()) {
    try {
      tempUrl = await callGeminiImage(prompt);
    } catch (err) {
      logError("ai.generateImage.gemini", err);
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
  if (readEnv("BLOB_READ_WRITE_TOKEN")) {
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
      logError("ai.generateImage.blobUpload", err);
    }
  }

  return tempUrl;
}

function readGeminiInlineImage(data: unknown): string | null {
  const response = data as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType || "image/png";
        return `data:${mimeType};base64,${part.inlineData.data}`;
      }
    }
  }
  return null;
}

async function callGeminiImage(prompt: string): Promise<string | null> {
  const model = readEnv("GEMINI_IMAGE_MODEL") || "gemini-3.1-flash-image-preview";
  const apiKey = getGeminiApiKey();
  const projectId = getVertexProjectId();
  const location = readEnv("GOOGLE_CLOUD_LOCATION") || "global";
  const endpoint = apiKey
    ? `${GEMINI_DEVELOPER_BASE}/models/${model}:generateContent`
    : `${VERTEX_BASE}/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  if (!apiKey && !projectId) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${await getVertexAccessToken()}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseModalities: ["IMAGE"],
      },
    }),
  });

  if (!res.ok) {
    throw new AIProviderError(`Gemini image API error ${res.status}`, {
      provider: "gemini",
      code: res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : "unknown",
      status: res.status,
    });
  }

  return readGeminiInlineImage(await res.json());
}
