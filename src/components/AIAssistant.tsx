"use client";

import { useState, useCallback, useRef } from "react";
import { Sparkles, X, Loader2, Copy, Check, Download } from "lucide-react";
import { AssistantTabs, type ActionTab } from "@/components/assistant/AssistantTabs";
import { useDialogFocus } from "@/hooks/useDialogFocus";

interface AIAssistantProps {
  context?: string;
  defaultTab?: ActionTab;
}

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
      type="button"
      onClick={handleCopy}
      className="flex min-h-11 items-center gap-1 rounded bg-gray-700 px-3 text-xs text-gray-400 transition-colors hover:bg-gray-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

function MarkdownResult({ content }: { content: string }) {
  return (
    <div className="mt-3" role="region" aria-labelledby="ai-assistant-result-title">
      <div className="flex items-center justify-between mb-2">
        <span id="ai-assistant-result-title" className="text-xs text-gray-400">Résultat</span>
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
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeAssistant = useCallback(() => setOpen(false), []);

  useDialogFocus({
    open,
    onClose: closeAssistant,
    containerRef: drawerRef,
    initialFocusRef: closeButtonRef,
    returnFocusRef: openButtonRef,
    lockScroll: true,
  });

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

        if (!res.ok) {
          setError(data.success ? `Le service a répondu avec l’erreur HTTP ${res.status}.` : data.error);
        } else if (!data.success) {
          setError(data.error);
        } else if (data.url !== undefined) {
          if (data.url) setImageUrl(data.url);
          else setError("Aucune image n’a été produite. Réessaie avec une description plus précise.");
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

  const statusMessage = loading
    ? "Traitement en cours."
    : result
      ? "Le résultat est disponible."
      : imageUrl
        ? "L’image générée est disponible."
        : "";

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex min-h-11 items-center gap-2 rounded-full border border-blue-400/40 bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-950/50 transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300 sm:bottom-5 sm:right-5"
        aria-label="Ouvrir l'assistant IA"
        aria-controls="ai-assistant-dialog"
        aria-expanded={open}
      >
        <Sparkles size={18} aria-hidden="true" />
        <span className="hidden sm:inline">Assistant IA</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onMouseDown={closeAssistant} aria-hidden="true" />
          <aside
            id="ai-assistant-dialog"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-assistant-title"
            className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-full flex-col border-l border-gray-800 bg-gray-950 shadow-2xl sm:w-[28rem]"
          >
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-blue-300" aria-hidden="true" />
                <h2 id="ai-assistant-title" className="text-sm font-semibold text-white">Assistant IA SEO</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeAssistant}
                className="grid h-11 w-11 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                aria-label="Fermer l'assistant IA"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <AssistantTabs activeTab={activeTab} onChange={handleTabChange} />

            <div
              id="ai-assistant-panel"
              role="tabpanel"
              aria-labelledby={`ai-tab-${activeTab}`}
              aria-busy={loading}
              className="flex-1 space-y-3 overflow-y-auto p-4"
            >
              <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {statusMessage}
              </p>
          {activeTab === "write" && (
            <div className="space-y-3">
              <label htmlFor="assistant-write-prompt" className="text-xs text-gray-400">Sujet / instructions</label>
              <textarea
                id="assistant-write-prompt"
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500 h-28"
                placeholder="Ex: Article sur les Core Web Vitals pour e-commerce…"
                value={writeState.prompt}
                onChange={(e) => setWriteState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <div>
                <label htmlFor="assistant-write-tone" className="text-xs text-gray-400 block mb-1">Ton</label>
                <select
                  id="assistant-write-tone"
                  className="min-h-11 w-full rounded border border-gray-700 bg-gray-800 p-2 text-sm text-white focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  value={writeState.tone}
                  onChange={(e) => setWriteState((s) => ({ ...s, tone: e.target.value }))}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleWrite}
                disabled={loading || !writeState.prompt.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Générer
              </button>
            </div>
          )}

          {activeTab === "translate" && (
            <div className="space-y-3">
              <label htmlFor="assistant-translate-prompt" className="text-xs text-gray-400">Texte à traduire</label>
              <textarea
                id="assistant-translate-prompt"
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500 h-28"
                placeholder="Collez votre texte ici…"
                value={translateState.prompt}
                onChange={(e) => setTranslateState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <div>
                <label htmlFor="assistant-translate-lang" className="text-xs text-gray-400 block mb-1">Langue cible</label>
                <select
                  id="assistant-translate-lang"
                  className="min-h-11 w-full rounded border border-gray-700 bg-gray-800 p-2 text-sm text-white focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  value={translateState.targetLang}
                  onChange={(e) => setTranslateState((s) => ({ ...s, targetLang: e.target.value }))}
                >
                  {LANGS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleTranslate}
                disabled={loading || !translateState.prompt.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Traduire
              </button>
            </div>
          )}

          {activeTab === "image" && (
            <div className="space-y-3">
              <label htmlFor="assistant-image-prompt" className="text-xs text-gray-400">Description de l&apos;image</label>
              <textarea
                id="assistant-image-prompt"
                className="h-28 w-full resize-none rounded border border-gray-700 bg-gray-800 p-2 text-sm text-white focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                placeholder="Ex: Infographie SEO moderne, fond sombre, icônes colorées, style tech…"
                value={imageState.prompt}
                onChange={(e) => setImageState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <button
                type="button"
                onClick={handleImage}
                disabled={loading || !imageState.prompt.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Générer l&apos;image
              </button>
            </div>
          )}

          {activeTab === "analyze" && (
            <div className="space-y-3">
              <label htmlFor="assistant-analyze-prompt" className="text-xs text-gray-400">Données à analyser</label>
              <textarea
                id="assistant-analyze-prompt"
                className="h-28 w-full resize-none rounded border border-gray-700 bg-gray-800 p-2 text-sm text-white focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                placeholder="Collez vos données SEO, métriques, URLs…"
                value={analyzeState.prompt}
                onChange={(e) => setAnalyzeState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={loading || !analyzeState.prompt.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-green-600 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Analyser
              </button>
            </div>
          )}

          {activeTab === "eeat" && (
            <div className="space-y-3">
              <div className="bg-yellow-900/30 border border-yellow-700/40 rounded p-2 text-xs text-yellow-200">
                <strong>Brief E-E-A-T sourcé sans API</strong><br />
                1. Recherche publique Bing RSS + DuckDuckGo<br />
                2. Preuves reliées aux URL et plan éditorial vérifiable<br />
                Aucun volume, backlink ou classement Google inventé
              </div>
              <label htmlFor="assistant-eeat-prompt" className="text-xs text-gray-400">Sujet de l&apos;article</label>
              <textarea
                id="assistant-eeat-prompt"
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-yellow-500 h-20"
                placeholder="Ex: Comment l'IA vocale transforme le service client B2B en 2026"
                value={eeatState.prompt}
                onChange={(e) => setEeatState((s) => ({ ...s, prompt: e.target.value }))}
              />
              <label htmlFor="assistant-eeat-tone" className="text-xs text-gray-400">Ton</label>
              <select
                id="assistant-eeat-tone"
                className="min-h-11 w-full rounded border border-gray-700 bg-gray-800 p-2 text-sm text-white focus:border-yellow-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
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
                type="button"
                onClick={handleEeat}
                disabled={loading || !eeatState.prompt.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-gradient-to-r from-yellow-600 to-orange-600 py-2 text-sm font-medium text-white transition-colors hover:from-yellow-500 hover:to-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                {loading ? "Recherche des sources..." : "Créer le brief E-E-A-T sourcé"}
              </button>
            </div>
          )}

          {activeTab === "research" && (
            <div className="space-y-3">
              <div className="bg-blue-900/30 border border-blue-700/40 rounded p-2 text-xs text-blue-200">
                <strong>Recherche web sourcée sans API</strong> — Bing RSS + DuckDuckGo, crawl sécurisé et URL citées. Les positions restent propres à chaque source et ne sont jamais présentées comme Google.
              </div>
              <label htmlFor="assistant-research-prompt" className="text-xs text-gray-400">Question / recherche</label>
              <textarea
                id="assistant-research-prompt"
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500 h-24"
                placeholder="Ex: Top 10 concurrents pour 'agent IA vocal' en France 2026"
                value={researchState.prompt}
                onChange={(e) => setResearchState({ prompt: e.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                {[
                  "Résultats publics pour [mot-clé]",
                  "Concurrents directs de [marque]",
                  "Articles tendance sur [sujet] 2026",
                  "Pages et sources visibles de [domaine]",
                ].map((q) => (
                  <button
                    type="button"
                    key={q}
                    onClick={() => setResearchState({ prompt: q })}
                    className="min-h-11 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-[10px] text-gray-300 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleResearch}
                disabled={loading || !researchState.prompt.trim()}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Rechercher avec sources
              </button>
            </div>
          )}

          {error && (
            <div role="alert" aria-live="assertive" aria-atomic="true" className="bg-red-900/40 border border-red-700 rounded p-3 text-red-300 text-xs">
              {error}
            </div>
          )}

          {result && <MarkdownResult content={result} />}

          {imageUrl && (
            <div className="mt-3" role="region" aria-labelledby="ai-assistant-image-title">
              <div className="flex items-center justify-between mb-2">
                <span id="ai-assistant-image-title" className="text-xs text-gray-400">Image générée</span>
                <div className="flex gap-2">
                  <CopyButton text={imageUrl} />
                  <a
                    href={imageUrl}
                    download="seo-image.jpg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-1 rounded bg-gray-700 px-3 py-2 text-xs text-gray-400 transition-colors hover:bg-gray-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    <Download size={12} aria-hidden="true" />
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

          {activeTab === "image" && imageUrl === null && !loading && result === null && error === null && (
            <p className="text-xs text-gray-500 text-center mt-2">
              L&apos;image apparaîtra ici après génération.
            </p>
          )}
        </div>
          </aside>
        </>
      )}
    </>
  );
}
