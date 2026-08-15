"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, Download, ExternalLink } from "lucide-react";
import Link from "next/link";

interface PromptItem {
  prompt: string;
  intent: "info" | "transac" | "comm" | "nav";
  reasoning: string;
}

type PromptSource = "local_engine" | "validated_cache" | "validated_ai";

interface PromptPayload {
  success: true;
  prompts: PromptItem[];
  notice: string;
  source: PromptSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPromptItem(value: unknown): value is PromptItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.prompt === "string"
    && item.prompt.trim().length > 0
    && ["info", "transac", "comm", "nav"].includes(String(item.intent))
    && typeof item.reasoning === "string";
}

function isPromptSource(value: unknown): value is PromptSource {
  return value === "local_engine" || value === "validated_cache" || value === "validated_ai";
}

function parsePromptPayload(value: unknown): PromptPayload | null {
  if (!isRecord(value)
    || value.success !== true
    || !Array.isArray(value.prompts)
    || value.prompts.length === 0
    || !value.prompts.every(isPromptItem)
    || typeof value.notice !== "string"
    || !isPromptSource(value.source)) {
    return null;
  }
  return value as unknown as PromptPayload;
}

function apiError(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  return fallback;
}

const INTENT_LABELS: Record<string, string> = {
  info: "Informationnel",
  transac: "Transactionnel",
  comm: "Commercial",
  nav: "Navigationnel",
};

const INTENT_COLORS: Record<string, string> = {
  info: "text-blue-400 bg-blue-900/30 border-blue-800",
  transac: "text-green-400 bg-green-900/30 border-green-800",
  comm: "text-yellow-400 bg-yellow-900/30 border-yellow-800",
  nav: "text-purple-400 bg-purple-900/30 border-purple-800",
};

const LANG_OPTIONS = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
];

export default function AIPromptsPage() {
  const [topic, setTopic] = useState("");
  const [lang, setLang] = useState<"fr" | "en" | "de" | "es" | "it">("fr");
  const [loading, setLoading] = useState(false);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);

  async function generate() {
    const requestedTopic = topic.trim();
    if (!requestedTopic) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-prompts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: requestedTopic, lang }),
      });
      const data = await res.json().catch(() => null) as unknown;
      if (!res.ok) {
        throw new Error(apiError(data, `Génération impossible (HTTP ${res.status})`));
      }
      const parsed = parsePromptPayload(data);
      if (!parsed) throw new Error("La réponse reçue ne respecte pas le contrat attendu pour les prompts.");

      setPrompts(parsed.prompts);
      const source = parsed.source === "local_engine"
        ? "Moteur local déterministe"
        : parsed.source === "validated_cache"
          ? "Réponse externe validée depuis le cache"
          : "Réponse externe validée";
      setSourceNotice(`${source} pour « ${requestedTopic} ». ${parsed.notice}`.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur réseau pendant la génération.";
      setError(`${message}${prompts.length > 0 ? " Le dernier résultat validé reste affiché." : ""}`);
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    const header = "Prompt,Intent,Reasoning";
    const rows = prompts.map((p) =>
      `"${p.prompt.replace(/"/g, '""')}","${p.intent}","${p.reasoning.replace(/"/g, '""')}"`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-prompts-${topic.slice(0, 30)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const grouped = prompts.reduce<Record<string, PromptItem[]>>((acc, p) => {
    const key = p.intent ?? "info";
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <h1 className="text-xl">AI Prompts</h1>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label htmlFor="ai-prompt-topic" className="text-xs text-gray-400 uppercase block mb-1">Thème / Mot-clé</label>
              <input id="ai-prompt-topic" value={topic} onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void generate(); }}
                placeholder="ex: logiciel comptabilité PME"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label htmlFor="ai-prompt-language" className="text-xs text-gray-400 uppercase block mb-1">Langue</label>
              <select id="ai-prompt-language" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={generate} disabled={loading || !topic.trim()}
              className="flex min-h-11 items-center gap-2 px-5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Génération..." : "Générer 30 prompts"}
            </button>
            {prompts.length > 0 && (
              <button type="button" onClick={exportCSV}
                className="flex min-h-11 items-center gap-2 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            )}
          </div>
        </div>

        {error && (
          <div role="alert" className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {sourceNotice && <div role="status" className="rounded-lg border border-blue-800 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">{sourceNotice}</div>}

        {prompts.length > 0 && (
          <div className="space-y-6">
            {(["info", "comm", "transac", "nav"] as const).map((intent) => {
              const items = grouped[intent];
              if (!items || items.length === 0) return null;
              return (
                <div key={intent} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${INTENT_COLORS[intent]}`}>
                      {INTENT_LABELS[intent]}
                    </span>
                    <span className="text-xs text-gray-500">{items.length} prompts</span>
                  </div>
                  <div className="divide-y divide-gray-800/50">
                    {items.map((p, i) => (
                      <div key={i} data-testid="prompt-item" className="px-5 py-3 flex items-start gap-3 hover:bg-gray-800/20 group">
                        <div className="flex-1">
                          <div className="text-sm text-gray-200">{p.prompt}</div>
                          {p.reasoning && (
                            <div className="text-xs text-gray-500 mt-0.5">{p.reasoning}</div>
                          )}
                        </div>
                        <a
                          href={`/ai-visibility?query=${encodeURIComponent(p.prompt)}`}
                          className="flex min-h-11 items-center gap-1 rounded bg-blue-600/20 px-3 text-xs text-blue-300 opacity-70 transition-all hover:bg-blue-600/40 hover:opacity-100 focus-visible:opacity-100"
                        >
                          <ExternalLink className="w-3 h-3" /> Tester
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && prompts.length === 0 && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center text-gray-500 text-sm">
            Saisis un thème. Le moteur local fonctionne sans API ; un fournisseur externe n&apos;est utilisé que si le serveur l&apos;autorise explicitement.
          </div>
        )}
      </div>
    </div>
  );
}
