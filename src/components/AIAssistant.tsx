"use client";

import { useState, useCallback } from "react";
import { Sparkles, X, Loader2, Copy, Check, Download } from "lucide-react";

type ActionTab = "write" | "translate" | "image" | "analyze" | "research" | "eeat";

interface AIAssistantProps {
  context?: string;
  defaultTab?: ActionTab;
}

const TABS: { id: ActionTab; label: string }[] = [
  { id: "eeat", label: "🏆 E-E-A-T" },
  { id: "write", label: "✍️ Rédac" },
  { id: "translate", label: "🌐 Trad" },
  { id: "image", label: "🎨 Image" },
  { id: "analyze", label: "🔍 Analyse" },
  { id: "research", label: "🔎 SERP" },
];

const TONES = ["professionnel", "décontracté", "technique", "marketing"];
const LANGS = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "de", label: "Allemand" },
  { value: "es", label: "Espagnol" },
  { value: "it", label: "Italien" },
];

interface WriteState {
  prompt: string;
  tone: string;
}

interface TranslateState {
  prompt: string;
  targetLang: string;
}

interface ImageState {
  prompt: string;
}

interface AnalyzeState {
  prompt: string;
}

type ApiResponse =
  | { success: true; reply: string; url?: undefined }
  | { success: true; url: string | null; reply?: undefined }
  | { success: false; error: string };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

function MarkdownResult({ content }: { content: string }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">Résultat</span>
        <CopyButton text={content} />
      </div>
      <div className="bg-gray-800 rounded p-3 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
        {content}
      </div>
    </div>
  );
}

export function AIAssistant({ context, defaultTab = "write" }: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActionTab>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [writeState, setWriteState] = useState<WriteState>({ prompt: "", tone: "professionnel" });
  const [translateState, setTranslateState] = useState<TranslateState>({ prompt: "", targetLang: "en" });
  const [imageState, setImageState] = useState<ImageState>({ prompt: "" });
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ prompt: context ?? "" });
  const [researchState, setResearchState] = useState<{ prompt: string }>({ prompt: "" });
  const [eeatState, setEeatState] = useState<{ prompt: string; tone: string }>({ prompt: "", tone: "expert professionnel" });

  const resetResult = () => {
    setResult(null);
    setImageUrl(null);
    setError(null);
  };

  const handleTabChange = (tab: ActionTab) => {
    setActiveTab(tab);
    resetResult();
  };

  const callApi = useCallback(
    async (payload: Record<string, unknown>) => {
      setLoading(true);
      setError(null);
      setResult(null);
      setImageUrl(null);

      try {
        const res = await fetch("/api/ai/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = (await res.json()) as ApiResponse;

        if (!data.success) {
          setError(data.error);
        } else if (data.url !== undefined) {
          setImageUrl(data.url);
        } else if (data.reply !== undefined) {
          setResult(data.reply);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur réseau");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleWrite = () => {
    if (!writeState.prompt.trim()) return;
    void callApi({ action: "write", prompt: writeState.prompt, tone: writeState.tone });
  };

  const handleTranslate = () => {
    if (!translateState.prompt.trim()) return;
    void callApi({ action: "translate", prompt: translateState.prompt, targetLang: translateState.targetLang });
  };

  const handleImage = () => {
    if (!imageState.prompt.trim()) return;
    void callApi({ action: "image", prompt: imageState.prompt });
  };

  const handleAnalyze = () => {
    if (!analyzeState.prompt.trim()) return;
    void callApi({ action: "analyze", prompt: analyzeState.prompt, context });
  };

  const handleResearch = () => {
    if (!researchState.prompt.trim()) return;
    void callApi({ action: "research", prompt: researchState.prompt, context });
  };

  const handleEeat = () => {
    if (!eeatState.prompt.trim()) return;
    void callApi({ action: "eeat", prompt: eeatState.prompt, tone: eeatState.tone, context });
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-white font-medium text-sm transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500"
        style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)" }}
        aria-label="Ouvrir l'assistant IA"
      >
        <Sparkles size={18} />
        <span className="hidden sm:inline">Assistant IA</span>
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-96 z-50 bg-gray-950 border-l border-gray-800 shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400" />
            <span className="text-white font-semibold text-sm">Assistant IA SEO</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-white border-b-2 border-purple-500"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Write tab */}
          {activeTab === "write" && (
            <div className="space-y-3">
              <label className="text-xs text-gray-400">Sujet / instructions</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500 h-28"
                placeholder="Ex: Article sur les Core Web Vitals pour e-commerce…"
                value={writeState.prompt}
                onChange={(e) => setWriteState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ton</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  value={writeState.tone}
                  onChange={(e) => setWriteState((s) => ({ ...s, tone: e.target.value }))}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleWrite}
                disabled={loading || !writeState.prompt.trim()}
                className="w-full py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Générer
              </button>
            </div>
          )}

          {/* Translate tab */}
          {activeTab === "translate" && (
            <div className="space-y-3">
              <label className="text-xs text-gray-400">Texte à traduire</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500 h-28"
                placeholder="Collez votre texte ici…"
                value={translateState.prompt}
                onChange={(e) => setTranslateState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <div>
                <label className="text-xs text-gray-400 block mb-1">Langue cible</label>
                <select
                  className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  value={translateState.targetLang}
                  onChange={(e) => setTranslateState((s) => ({ ...s, targetLang: e.target.value }))}
                >
                  {LANGS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleTranslate}
                disabled={loading || !translateState.prompt.trim()}
                className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Traduire
              </button>
            </div>
          )}

          {/* Image tab */}
          {activeTab === "image" && (
            <div className="space-y-3">
              <label className="text-xs text-gray-400">Description de l&apos;image</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500 h-28"
                placeholder="Ex: Infographie SEO moderne, fond sombre, icônes colorées, style tech…"
                value={imageState.prompt}
                onChange={(e) => setImageState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <button
                onClick={handleImage}
                disabled={loading || !imageState.prompt.trim()}
                className="w-full py-2 rounded bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Générer l&apos;image
              </button>
            </div>
          )}

          {/* Analyze tab */}
          {activeTab === "analyze" && (
            <div className="space-y-3">
              <label className="text-xs text-gray-400">Données à analyser</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500 h-28"
                placeholder="Collez vos données SEO, métriques, URLs…"
                value={analyzeState.prompt}
                onChange={(e) => setAnalyzeState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <button
                onClick={handleAnalyze}
                disabled={loading || !analyzeState.prompt.trim()}
                className="w-full py-2 rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Analyser
              </button>
            </div>
          )}

          {/* E-E-A-T tab — Perplexity research → Sonnet writing pipeline */}
          {activeTab === "eeat" && (
            <div className="space-y-3">
              <div className="bg-yellow-900/30 border border-yellow-700/40 rounded p-2 text-xs text-yellow-200">
                🏆 <strong>Pipeline E-E-A-T 2 phases</strong>:<br />
                1️⃣ Perplexity → recherche sources réelles 2026<br />
                2️⃣ Sonnet 4.6 → rédaction avec citations<br />
                ⏱️ ~60-90s · Article 1500-2500 mots avec sources URL
              </div>
              <label className="text-xs text-gray-400">Sujet de l&apos;article</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-yellow-500 h-20"
                placeholder="Ex: Comment l'IA vocale transforme le service client B2B en 2026"
                value={eeatState.prompt}
                onChange={(e) => setEeatState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <label className="text-xs text-gray-400">Ton</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-yellow-500"
                value={eeatState.tone}
                onChange={(e) => setEeatState((s) => ({ ...s, tone: e.target.value }))}
              >
                <option value="expert professionnel">Expert professionnel</option>
                <option value="journalistique">Journalistique</option>
                <option value="académique">Académique</option>
                <option value="vulgarisation">Vulgarisation grand public</option>
                <option value="technique pointu">Technique pointu</option>
              </select>
              <button
                onClick={handleEeat}
                disabled={loading || !eeatState.prompt.trim()}
                className="w-full py-2 rounded bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? "Recherche + rédaction..." : "Générer article E-E-A-T"}
              </button>
            </div>
          )}

          {/* Research tab — Perplexity sonar-pro live SERP */}
          {activeTab === "research" && (
            <div className="space-y-3">
              <div className="bg-blue-900/30 border border-blue-700/40 rounded p-2 text-xs text-blue-200">
                🌐 <strong>Perplexity sonar-pro</strong> — accès SERP Google live + sources URL citées. Idéal: concurrents, mots-clés tendance, contenu récent.
              </div>
              <label className="text-xs text-gray-400">Question / recherche</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500 h-24"
                placeholder="Ex: Top 10 concurrents pour 'agent IA vocal' en France 2026"
                value={researchState.prompt}
                onChange={(e) => setResearchState({ prompt: e.target.value })}
              />
              <div className="flex flex-wrap gap-1">
                {[
                  "Top 10 SERP pour [mot-clé]",
                  "Concurrents directs de [marque]",
                  "Articles tendance sur [sujet] 2026",
                  "Backlinks visibles de [domaine]",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setResearchState({ prompt: q })}
                    className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded border border-gray-700"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <button
                onClick={handleResearch}
                disabled={loading || !researchState.prompt.trim()}
                className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Rechercher (live)
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Text result */}
          {result && <MarkdownResult content={result} />}

          {/* Image result */}
          {imageUrl && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">Image générée</span>
                <div className="flex gap-2">
                  <CopyButton text={imageUrl} />
                  <a
                    href={imageUrl}
                    download="seo-image.jpg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
                  >
                    <Download size={12} />
                    Télécharger
                  </a>
                </div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Image SEO générée"
                className="w-full rounded border border-gray-700"
              />
            </div>
          )}

          {/* No image returned */}
          {activeTab === "image" && imageUrl === null && !loading && result === null && error === null && (
            <p className="text-xs text-gray-500 text-center mt-2">
              L&apos;image apparaîtra ici après génération.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
