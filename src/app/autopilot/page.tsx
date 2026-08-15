"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Zap, Clock, CheckCircle, XCircle, ExternalLink, Globe, Image as ImageIcon, PlayCircle, RefreshCw, LockKeyhole, ShieldAlert } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { useDialogFocus } from "@/hooks/useDialogFocus";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface AutopilotRun {
  id: number;
  site_id: number;
  site_name: string;
  keyword: string;
  article_title: string;
  github_url: string | null;
  /** URL publique sur le site (blog) */
  published_url: string | null;
  image_url: string | null;
  status: string;
  language?: string;
  created_at: string;
}

interface LinkStats {
  total: number;
  valid: number;
  fuzzy: number;
  roundRobin: number;
  skipped: number;
}

interface AutopilotResult {
  success: boolean;
  keyword?: string;
  language?: string;
  article_title?: string;
  article_preview?: string;
  github_url?: string | null;
  published_url?: string | null;
  image_url?: string | null;
  dry_run?: boolean;
  status?: string;
  error?: string;
  repo_matched?: string | null;
  link_candidates_count?: number;
  link_stats?: LinkStats;
}

const LANGUAGES = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "pt", label: "Português" },
];

interface SiteLangRow {
  id: number;
  name: string;
  target_languages: string[];
}

type PublicationConfirmation =
  | { kind: "publish" }
  | { kind: "retry"; run: AutopilotRun };

export default function AutopilotPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("fr");
  const [siteLangs, setSiteLangs] = useState<SiteLangRow[]>([]);
  const [savingLangs, setSavingLangs] = useState(false);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    published: number;
    pending: number;
    failed: number;
    total: number;
    skipped: boolean;
    message: string | null;
  } | null>(null);
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [autopilotLocked, setAutopilotLocked] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [togglingAutopilot, setTogglingAutopilot] = useState(false);
  const [operationStatus, setOperationStatus] = useState<string | null>(null);
  const [publicationConfirmation, setPublicationConfirmation] = useState<PublicationConfirmation | null>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const cancelConfirmationRef = useRef<HTMLButtonElement>(null);

  const closePublicationConfirmation = useCallback(() => setPublicationConfirmation(null), []);
  useDialogFocus({
    open: publicationConfirmation !== null,
    onClose: closePublicationConfirmation,
    containerRef: confirmationRef,
    initialFocusRef: cancelConfirmationRef,
    lockScroll: true,
  });

  function messageFrom(value: unknown, fallback: string): string {
    return value instanceof Error && value.message ? value.message : fallback;
  }

  // Initial load is intentionally tied to the page mount.
  useEffect(() => {
    fetchSites();
    fetchHistory();
    fetchSiteLangs();
    fetchAutopilotToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAutopilotToggle() {
    setConfigLoading(true);
    try {
      const res = await fetch("/api/autopilot/toggle");
      const data = await res.json().catch(() => ({})) as {
        success?: boolean;
        enabled?: boolean;
        locked?: boolean;
        error?: string;
      };
      if (!res.ok || data.success === false || typeof data.enabled !== "boolean") {
        throw new Error(data.error || `Configuration indisponible (HTTP ${res.status})`);
      }
      setAutopilotEnabled(data.enabled);
      setAutopilotLocked(data.locked !== false);
    } catch (fetchError) {
      setAutopilotEnabled(false);
      setAutopilotLocked(true);
      setError(messageFrom(fetchError, "Impossible de vérifier le verrou de publication."));
    } finally {
      setConfigLoading(false);
    }
  }

  async function toggleAutopilot() {
    if (autopilotLocked) {
      setError("La publication planifiée est verrouillée : utilise l’aperçu puis une validation manuelle.");
      return;
    }
    setTogglingAutopilot(true);
    setError(null);
    const next = !autopilotEnabled;
    try {
      const res = await fetch("/api/autopilot/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({})) as {
        success?: boolean;
        enabled?: boolean;
        locked?: boolean;
        error?: string;
      };
      if (!res.ok || data.success !== true || typeof data.enabled !== "boolean") {
        throw new Error(data.error || `Mise à jour impossible (HTTP ${res.status})`);
      }
      setAutopilotEnabled(data.enabled);
      setAutopilotLocked(data.locked === true);
    } catch (e) {
      setError(messageFrom(e, "Impossible de modifier le mode planifié."));
    } finally {
      setTogglingAutopilot(false);
    }
  }

  async function fetchSiteLangs() {
    try {
      const res = await fetch("/api/sites/languages");
      const data = await res.json().catch(() => ({})) as { success?: boolean; sites?: SiteLangRow[]; error?: string };
      if (!res.ok || data.success !== true || !Array.isArray(data.sites)) {
        throw new Error(data.error || `Langues indisponibles (HTTP ${res.status})`);
      }
      setSiteLangs(data.sites);
    } catch (fetchError) {
      setError(messageFrom(fetchError, "Impossible de charger les langues des sites."));
    }
  }

  async function toggleSiteLang(siteId: number, lang: string) {
    const row = siteLangs.find((r) => r.id === siteId);
    if (!row) return;
    const current = row.target_languages ?? ["fr"];
    const next = current.includes(lang)
      ? current.filter((l) => l !== lang)
      : [...current, lang];
    if (next.length === 0) return; // must keep at least 1

    setSavingLangs(true);
    setError(null);
    try {
      const res = await fetch("/api/sites/languages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: siteId, languages: next }),
      });
      const data = await res.json().catch(() => ({})) as { success?: boolean; languages?: string[]; error?: string };
      if (!res.ok || data.success !== true || !Array.isArray(data.languages)) {
        throw new Error(data.error || `Enregistrement impossible (HTTP ${res.status})`);
      }
      setSiteLangs((prev) =>
        prev.map((r) => (r.id === siteId ? { ...r, target_languages: data.languages! } : r))
      );
    } catch (saveError) {
      setError(messageFrom(saveError, "Impossible d’enregistrer les langues."));
    } finally {
      setSavingLangs(false);
    }
  }

  // Refresh the visible history when the selected site changes.
  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite]);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const data = await res.json().catch(() => ({})) as Site[] | { sites?: Site[]; error?: string };
      if (!res.ok) {
        const apiError = Array.isArray(data) ? null : data.error;
        throw new Error(apiError || `Sites indisponibles (HTTP ${res.status})`);
      }
      const list = Array.isArray(data) ? data : data.sites ?? [];
      setSites(list);
      if (list.length > 0 && !selectedSite) {
        setSelectedSite("all");
      }
    } catch (fetchError) {
      setError(messageFrom(fetchError, "Impossible de charger les sites."));
    }
  }

  async function fetchHistory() {
    setLoadingRuns(true);
    try {
      const url = selectedSite && selectedSite !== "all"
        ? `/api/autopilot/history?site_id=${selectedSite}`
        : "/api/autopilot/history";
      const res = await fetch(url);
      const data = await res.json().catch(() => ({})) as { success?: boolean; runs?: AutopilotRun[]; error?: string };
      if (!res.ok || data.success !== true || !Array.isArray(data.runs)) {
        throw new Error(data.error || `Historique indisponible (HTTP ${res.status})`);
      }
      setRuns(data.runs);
    } catch (fetchError) {
      setError(messageFrom(fetchError, "Impossible de charger l’historique."));
    } finally {
      setLoadingRuns(false);
    }
  }

  async function retryRun(run: AutopilotRun) {
    setRetryingId(run.id);
    setError(null);
    setOperationStatus(`Nouvelle tentative pour « ${run.keyword} »…`);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: run.site_id,
          dry_run: false,
          language: run.language ?? "fr",
          forced_keyword: run.keyword,
        }),
      });
      const data = await res.json().catch(() => ({})) as AutopilotResult;
      if (!res.ok || data.success !== true) {
        throw new Error(data.error || `Relance impossible (HTTP ${res.status})`);
      }
      setResult(data);
      await fetchHistory();
    } catch (retryError) {
      setError(messageFrom(retryError, "La relance a échoué."));
    } finally {
      setRetryingId(null);
      setOperationStatus(null);
    }
  }

  async function runAutopilot(dryRun: boolean) {
    if (!selectedSite || selectedSite === "all") {
      setError("Sélectionne un site d'abord");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);
    setOperationStatus(dryRun ? "Aperçu en cours : mot-clé, article et liens internes…" : "Publication manuelle en cours : génération, dépôt et vérification live…");

    let timeout: number | null = null;
    try {
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), dryRun ? 120000 : 240000);
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, dry_run: dryRun, language: selectedLanguage }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({})) as AutopilotResult;
      if (!res.ok || data.success !== true) {
        throw new Error(data.error || `Opération impossible (HTTP ${res.status})`);
      }
      setResult(data);
      if (!dryRun) await fetchHistory();
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setError(timedOut ? "L’opération a dépassé le délai autorisé. Aucun succès n’est supposé." : messageFrom(err, "Erreur réseau"));
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      setLoading(false);
      setOperationStatus(null);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function runBatchToday() {
    if (autopilotLocked) {
      setError("Le batch est verrouillé : la publication reste manuelle, site par site.");
      return;
    }
    setBatchRunning(true);
    setBatchResult(null);
    setError(null);
    setOperationStatus("Batch hebdomadaire en cours: cela peut prendre plusieurs minutes.");
    try {
      const res = await fetch("/api/autopilot/weekly", { method: "POST" });
      const d = await res.json().catch(() => ({})) as {
        success?: boolean;
        skipped?: boolean;
        message?: string;
        published?: number;
        pending_live?: number;
        failed?: number;
        total_runs?: number;
        results?: { status: string }[];
        error?: string;
      };
      if (!res.ok || d.success !== true) {
        throw new Error(d.error || `Batch impossible (HTTP ${res.status})`);
      }
      const results = d.results ?? [];
      setBatchResult({
        published: d.published ?? results.filter((r) => r.status === "published" || r.status === "verified_live").length,
        pending: d.pending_live ?? results.filter((r) => r.status === "published_pending_live").length,
        failed: d.failed ?? results.filter((r) => r.status === "failed").length,
        total: d.total_runs ?? results.length,
        skipped: d.skipped === true,
        message: d.message ?? null,
      });
      if (d.skipped !== true) await fetchHistory();
    } catch (err) {
      setError(messageFrom(err, "Erreur batch"));
    } finally {
      setBatchRunning(false);
      setOperationStatus(null);
    }
  }

  async function confirmPublicationAction() {
    const confirmation = publicationConfirmation;
    closePublicationConfirmation();
    if (!confirmation) return;
    if (confirmation.kind === "publish") {
      await runAutopilot(false);
      return;
    }
    await retryRun(confirmation.run);
  }

  function nextMondayAt9() {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntilMonday);
    next.setHours(9, 0, 0, 0);
    return next.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          <h1 className="text-xl font-semibold">Production SEO assistée</h1>
        </div>
      </div>

      {publicationConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePublicationConfirmation();
          }}
        >
          <div
            ref={confirmationRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="publication-confirmation-title"
            aria-describedby="publication-confirmation-description"
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-950/60 text-amber-300">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="publication-confirmation-title" className="text-lg font-semibold text-white">
                  Confirmer la publication manuelle
                </h2>
                <p id="publication-confirmation-description" className="mt-2 text-sm leading-6 text-slate-300">
                  {publicationConfirmation.kind === "retry"
                    ? `Relancer « ${publicationConfirmation.run.keyword} » peut modifier le dépôt du site ${publicationConfirmation.run.site_name}.`
                    : `Cette action cible uniquement ${sites.find((site) => site.id === selectedSite)?.name ?? "le site sélectionné"} en ${selectedLanguage.toUpperCase()} et peut rendre une nouvelle page publique.`}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs leading-5 text-slate-400">
              Une réponse de publication ne prouve ni l’indexation Google ni les performances SEO. Le statut live sera affiché séparément.
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelConfirmationRef}
                type="button"
                onClick={closePublicationConfirmation}
                className="min-h-11 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void confirmPublicationAction()}
                className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              >
                Confirmer et lancer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Scheduled publication guard */}
        <div className={`rounded-xl p-5 flex items-center justify-between gap-4 border transition-colors ${
          autopilotLocked
            ? "bg-blue-950/30 border-blue-800"
            : autopilotEnabled
              ? "bg-emerald-950/30 border-emerald-700"
              : "bg-slate-900 border-slate-700"
        }`}>
          <div className="flex items-center gap-4">
            {configLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : autopilotLocked ? (
              <LockKeyhole className="h-5 w-5 text-blue-300" />
            ) : (
              <span className={`h-3 w-3 rounded-full ${autopilotEnabled ? "bg-emerald-400" : "bg-slate-500"}`} />
            )}
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-white">
                {configLoading
                  ? "Vérification du verrou"
                  : autopilotLocked
                    ? "Publication automatique verrouillée"
                    : autopilotEnabled
                      ? "Publication planifiée activée"
                      : "Publication planifiée désactivée"}
              </div>
              <div className="text-sm text-gray-300 mt-1">
                {autopilotLocked
                  ? "Chaque article passe par un aperçu et une confirmation manuelle avant publication."
                  : autopilotEnabled
                    ? "Le traitement planifié est autorisé par la configuration du serveur."
                    : "Aucun article ne sera publié par le traitement planifié."}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleAutopilot}
            disabled={configLoading || togglingAutopilot || autopilotLocked}
            className={`min-h-11 px-5 py-2 rounded-lg font-semibold text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              autopilotEnabled
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
          >
            {togglingAutopilot ? "Mise à jour…" : autopilotLocked ? "Verrouillé" : autopilotEnabled ? "Désactiver" : "Activer"}
          </button>
        </div>

        {/* Status card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-4">
          <Clock className="w-8 h-8 text-blue-400 flex-shrink-0" />
          <div>
            <div className="text-sm text-gray-400">Publication planifiée</div>
            <div className="font-medium text-white">
              {autopilotLocked ? "Validation manuelle obligatoire" : autopilotEnabled ? nextMondayAt9() : "Désactivée"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/countries"
              className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-900/20 border border-cyan-800 rounded px-3 py-1.5 flex items-center gap-1.5"
            >
              <Globe className="w-3 h-3" /> Dashboard par pays
            </Link>
            <Link
              href="/autopilot/roi"
              className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border border-emerald-800 rounded px-3 py-1.5 flex items-center gap-1.5"
            >
              <CheckCircle className="h-3 w-3" /> Suivi publication
            </Link>
            <div className="text-xs text-gray-500 bg-gray-800 rounded px-2 py-1">
              {autopilotLocked ? "Batch verrouillé" : "Cron : lundi 9h00"}
            </div>
            {!autopilotLocked && (
              <button
                onClick={runBatchToday}
                disabled={batchRunning}
                className="flex min-h-11 items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-xs font-medium transition-colors hover:bg-orange-500 disabled:opacity-50"
              >
                {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                {batchRunning ? "Traitement en cours…" : "Lancer le batch autorisé"}
              </button>
            )}
          </div>
        </div>
        {batchResult && (
          <div className={`border rounded-xl px-5 py-4 flex items-center gap-4 ${batchResult.skipped ? "bg-blue-950/30 border-blue-800" : batchResult.failed === 0 ? "bg-green-900/20 border-green-800" : "bg-yellow-900/20 border-yellow-800"}`}>
            {batchResult.skipped ? <LockKeyhole className="h-5 w-5 text-blue-300" /> : <CheckCircle className={`w-5 h-5 flex-shrink-0 ${batchResult.failed === 0 ? "text-green-400" : "text-yellow-400"}`} />}
            <div>
              <div className="text-sm font-medium text-white">{batchResult.skipped ? "Batch non exécuté" : "Batch terminé"}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {batchResult.message ?? `${batchResult.published} publiés · ${batchResult.pending} en attente live · ${batchResult.failed} échecs · ${batchResult.total} total`}
              </div>
            </div>
          </div>
        )}

        {/* Auto mode config: target languages per site */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h2 className="font-medium text-gray-200">Langues proposées par site</h2>
            {savingLangs && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
          </div>
          <p className="text-xs text-gray-500">
            Ces préférences alimentent les aperçus. Elles ne constituent jamais une preuve de publication ni d’indexation.
          </p>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {siteLangs.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 p-3 bg-gray-800/40 rounded-lg border border-gray-800"
              >
                <div className="flex-1 text-sm text-gray-200 font-medium truncate">
                  {row.name}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {LANGUAGES.map((l) => {
                    const active = (row.target_languages ?? []).includes(l.code);
                    return (
                      <button
                        key={l.code}
                        onClick={() => toggleSiteLang(row.id, l.code)}
                        disabled={savingLangs}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          active
                            ? "bg-cyan-900/40 border-cyan-700 text-white"
                            : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                        }`}
                        title={l.label}
                      >
                        {l.code.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="font-medium text-gray-200">Lancer l&apos;autopilot</h2>
          {operationStatus && (loading || batchRunning) && (
            <div className="rounded-lg border border-blue-800 bg-blue-950/30 px-4 py-3 text-sm text-blue-200 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {operationStatus}
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            {/* Site selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-400">Site cible</label>
              <select
                aria-label="Site cible"
                value={selectedSite ?? ""}
                onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
              >
                <option value="all">Tous les sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Language selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-400 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> Langue de l&apos;article
              </label>
              <select
                aria-label="Langue de l'article"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-52"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => runAutopilot(true)}
              disabled={loading || !selectedSite || selectedSite === "all"}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 text-yellow-400" />
              )}
              Tester maintenant (aperçu)
            </button>

            <button
              onClick={() => setPublicationConfirmation({ kind: "publish" })}
              disabled={loading || !selectedSite || selectedSite === "all"}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Valider et publier
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Result preview */}
          {result && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                {result.status === "verified_live" ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Zap className="w-4 h-4 text-yellow-400" />
                )}
                <span className="font-medium text-sm">
                  {result.dry_run
                    ? "Aperçu généré"
                    : result.status === "verified_live"
                      ? "Publication vérifiée en ligne"
                      : result.status === "published_pending_live"
                        ? "Publication envoyée, vérification live en attente"
                        : result.status === "published"
                          ? "Publication envoyée"
                          : `Traitement terminé${result.status ? ` : ${result.status}` : ""}`}
                </span>
                {result.language && (
                  <span className="text-xs bg-gray-700 rounded px-2 py-0.5">
                    {result.language.toUpperCase()}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap items-center justify-end gap-3">
                  {result.published_url && (
                    <a
                      href={result.published_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={result.published_url}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      Article sur le site
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                  {result.github_url && (
                    <a
                      href={result.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-blue-400 hover:text-blue-300"
                    >
                      GitHub
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                </span>
              </div>

              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-gray-400">Mot-clé: </span>
                  <span className="text-white font-medium">{result.keyword}</span>
                </div>
                <div>
                  <span className="text-gray-400">Titre: </span>
                  <span className="text-white">{result.article_title}</span>
                </div>
                <div className="text-xs">
                  <span className="text-gray-400">Repo: </span>
                  <span className={result.repo_matched ? "text-green-400" : "text-red-400"}>
                    {result.repo_matched ?? "— aucun repo matché"}
                  </span>
                  <span className="text-gray-500 ml-2">
                    ({result.link_candidates_count ?? 0} slugs disponibles)
                  </span>
                </div>
                {result.link_stats && result.link_stats.total > 0 && (
                  <div className="text-xs flex gap-2 flex-wrap mt-1">
                    <span className="text-gray-400">Liens:</span>
                    <span className="bg-gray-900 px-2 py-0.5 rounded">
                      {result.link_stats.total} total
                    </span>
                    <span className="bg-green-900/40 text-green-300 px-2 py-0.5 rounded">
                      {result.link_stats.valid} valides
                    </span>
                    {result.link_stats.fuzzy > 0 && (
                      <span className="bg-yellow-900/40 text-yellow-300 px-2 py-0.5 rounded">
                        {result.link_stats.fuzzy} fuzzy
                      </span>
                    )}
                    {result.link_stats.roundRobin > 0 && (
                      <span className="bg-orange-900/40 text-orange-300 px-2 py-0.5 rounded">
                        {result.link_stats.roundRobin} remplacés
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Image preview */}
              {result.image_url ? (
                <div className="mt-2">
                  <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> Image générée (Gemini/Pollinations)
                  </div>
                  <div className="relative w-full max-w-md h-40 rounded-lg overflow-hidden border border-gray-700">
                    <Image
                      src={result.image_url}
                      alt={result.keyword ?? "article image"}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <a
                    href={result.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-flex items-center gap-1"
                  >
                    Ouvrir l&apos;image <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  <ImageIcon className="w-3 h-3" />
                  <span>Aucune image générée (Gemini indisponible, fallback image gratuit indisponible)</span>
                </div>
              )}

              {result.article_preview && (
                <div className="mt-2">
                  <div className="text-xs text-gray-400 mb-1">
                    Article complet · ~{result.article_preview.split(/\s+/).length} mots · {result.article_preview.length} chars
                  </div>
                  <pre className="text-xs text-gray-300 bg-gray-900 rounded p-3 overflow-auto whitespace-pre-wrap font-mono max-h-[600px]">
                    {result.article_preview}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent runs table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-medium text-gray-200">Runs récents</h2>
            <button
              onClick={fetchHistory}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              Actualiser
            </button>
          </div>

          {loadingRuns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              Aucun run pour le moment
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left font-medium">Site</th>
                    <th className="px-5 py-3 text-left font-medium">
                      <span className="inline-flex items-center gap-2">
                        Mot-clé
                        <CopyKeywordsButton keywords={runs.map((run) => run.keyword)} />
                      </span>
                    </th>
                    <th className="px-5 py-3 text-left font-medium">Langue</th>
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-5 py-3 text-left font-medium">Statut</th>
                    <th className="px-5 py-3 text-left font-medium">Image</th>
                    <th className="px-5 py-3 text-left font-medium">Article (site)</th>
                    <th className="px-5 py-3 text-left font-medium">GitHub</th>
                    <th className="px-5 py-3 text-left font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-5 py-3 text-gray-300">{run.site_name ?? `Site ${run.site_id}`}</td>
                      <td className="px-5 py-3">
                        <div className="text-white font-medium">{run.keyword}</div>
                        {run.article_title && run.article_title !== run.keyword && (
                          <div className="text-xs text-gray-400 truncate max-w-[200px]">{run.article_title}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400">
                        {run.language ? (
                          <span className="text-xs font-semibold uppercase" title={run.language.toUpperCase()}>
                            {run.language.toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold">FR</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                        {formatDate(run.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        {run.status === "verified_live" ? (
                          <span className="flex items-center gap-1 text-green-400">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Live vérifié
                          </span>
                        ) : run.status === "published" ? (
                          <span className="flex items-center gap-1 text-blue-300">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Publication envoyée
                          </span>
                        ) : run.status === "published_pending_live" ? (
                          <span className="flex items-center gap-1 text-amber-300">
                            <Clock className="w-3.5 h-3.5" />
                            Live à vérifier
                          </span>
                        ) : run.status === "dry_run" ? (
                          <span className="flex items-center gap-1 text-yellow-400">
                            <Zap className="w-3.5 h-3.5" />
                            Test
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-400">
                            <XCircle className="w-3.5 h-3.5" />
                            Échec
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {run.image_url ? (
                          <a
                            href={run.image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            Voir
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {run.published_url && ["verified_live", "published", "published_pending_live"].includes(run.status) ? (
                          <a
                            href={run.published_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={run.published_url}
                            className="inline-flex items-center gap-1.5 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 px-1 py-0.5 text-xs"
                          >
                            <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="whitespace-nowrap">Vérifier l&apos;article</span>
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {run.github_url ? (
                          <a
                            href={run.github_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Fichier <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {["failed", "error"].includes(run.status) && (
                          <button
                            type="button"
                            onClick={() => setPublicationConfirmation({ kind: "retry", run })}
                            disabled={retryingId === run.id}
                            className="flex min-h-11 items-center gap-1 rounded bg-orange-600/20 px-3 py-2 text-xs text-orange-300 hover:bg-orange-600/30 disabled:opacity-50"
                          >
                            {retryingId === run.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Relancer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// Sat May  2 09:31:48     2026
