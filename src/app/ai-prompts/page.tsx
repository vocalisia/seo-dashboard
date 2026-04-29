"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, Download, ExternalLink } from "lucide-react";
import Link from "next/link";

interface PromptItem {
  prompt: string;
  intent: "info" | "transac" | "comm" | "nav";
  reasoning: string;
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

  async function generate() {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setPrompts([]);
    try {
      const res = await fetch("/api/ai-prompts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), lang }),
      });
      const data = await res.json() as { success: boolean; prompts?: PromptItem[]; error?: string };
      if (data.success && data.prompts) {
        setPrompts(data.prompts);
      } else {
        setError(data.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
    setLoading(false);
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
        <span className="text-xl">AI Prompts</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 uppercase block mb-1">Thème / Mot-clé</label>
              <input value={topic} onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void generate(); }}
                placeholder="ex: logiciel comptabilité PME"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Langue</label>
              <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={generate} disabled={loading || !topic.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Génération..." : "Générer 30 prompts"}
            </button>
            {prompts.length > 0 && (
              <button onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>
        )}

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
                      <div key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-800/20 group">
                        <div className="flex-1">
                          <div className="text-sm text-gray-200">{p.prompt}</div>
                          {p.reasoning && (
                            <div className="text-xs text-gray-500 mt-0.5">{p.reasoning}</div>
                          )}
                        </div>
                        <a
                          href={`/ai-visibility?query=${encodeURIComponent(p.prompt)}`}
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs transition-all"
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
            Saisis un thème et génère 30 prompts IA à cibler
          </div>
        )}
      </div>
    </div>
  );
}
