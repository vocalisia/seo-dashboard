"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { ToolAlert, ToolEmptyState, ToolLoadingState, ToolPage, ToolPanel } from "@/components/dashboard/ToolPage";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface ContentItem {
  id: number;
  title: string;
  target_keyword: string;
  target_url: string | null;
  action_type: "refresh_existing" | "improve_snippet" | null;
  opportunity_type: "striking" | "low_ctr" | null;
  score: number;
  rationale: string;
  clicks: number;
  impressions: number;
  position: number | null;
  status: "todo" | "doing" | "done";
}

type StatusFilter = "all" | "todo" | "doing" | "done";

const STATUS_LABELS: Record<ContentItem["status"], string> = {
  todo: "À faire",
  doing: "En cours",
  done: "Terminé",
};

const ACTION_LABELS: Record<NonNullable<ContentItem["action_type"]>, string> = {
  refresh_existing: "Renforcer la page",
  improve_snippet: "Optimiser title et meta",
};

export default function ContentPlanPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const loadSavedPlan = useCallback(async (siteId: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/content-plan/generate?siteId=${siteId}`, { cache: "no-store", signal });
      const data = await response.json() as { success: boolean; items?: ContentItem[]; methodology?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? `Lecture impossible (HTTP ${response.status})`);
      setItems(data.items ?? []);
      setNotice(data.methodology ?? null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setItems([]);
      setError(reason instanceof Error ? reason.message : "Le plan sauvegardé ne peut pas être lu.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/sites", { signal: controller.signal });
        const data = await response.json() as Site[] | { sites?: Site[]; error?: string };
        if (!response.ok) throw new Error(!Array.isArray(data) && data.error ? data.error : `Sites indisponibles (HTTP ${response.status})`);
        const list = Array.isArray(data) ? data : (data.sites ?? []);
        setSites(list);
        if (list.length > 0) setSelectedSite(list[0].id);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Les sites ne peuvent pas être chargés.");
      } finally {
        if (!controller.signal.aborted) setSitesLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    const controller = new AbortController();
    void loadSavedPlan(selectedSite, controller.signal);
    return () => controller.abort();
  }, [loadSavedPlan, selectedSite]);

  async function generate() {
    if (!selectedSite) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/content-plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSite }),
      });
      const data = await response.json() as { success: boolean; items?: ContentItem[]; methodology?: string; error?: string };
      if (!response.ok || !data.success || !data.items) throw new Error(data.error ?? `Génération impossible (HTTP ${response.status})`);
      setItems(data.items);
      setNotice(data.methodology ?? "Plan recalculé depuis les mesures GSC.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Le plan ne peut pas être généré.");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: number, status: ContentItem["status"]) {
    setUpdatingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/content-plan/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? `Mise à jour impossible (HTTP ${response.status})`);
      setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Le statut n'a pas été enregistré.");
    } finally {
      setUpdatingId(null);
    }
  }

  const filtered = useMemo(() => items.filter((item) => statusFilter === "all" || item.status === statusFilter), [items, statusFilter]);
  const selectedSiteName = sites.find((site) => site.id === selectedSite)?.name ?? "ce site";

  return (
    <ToolPage
      title="Plan d’actions contenu"
      eyebrow="Opportunités mesurées"
      description="Priorise les pages existantes à renforcer depuis les impressions, positions et clics GSC des 30 derniers jours. Aucun article n’est publié et aucune difficulté SEO n’est inventée."
      icon={ClipboardList}
      width="wide"
      actions={(
        <button type="button" onClick={() => void generate()} disabled={loading || !selectedSite} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {loading ? "Calcul en cours" : "Recalculer depuis GSC"}
        </button>
      )}
    >
      <ToolPanel className="p-4">
        <label htmlFor="content-plan-site" className="mb-2 block text-sm font-medium text-white">Site analysé</label>
        <select id="content-plan-site" value={selectedSite ?? ""} onChange={(event) => { setSelectedSite(Number(event.target.value)); setStatusFilter("all"); }} disabled={sitesLoading} className="h-12 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-white outline-none focus:ring-2 focus:ring-blue-400">
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
        <p className="mt-2 text-xs leading-5 text-slate-500">La régénération conserve les statuts « En cours » et « Terminé » des mots-clés toujours présents.</p>
      </ToolPanel>

      {error && <ToolAlert tone="error">{error}</ToolAlert>}
      {notice && !error && <ToolAlert tone="info">{notice}</ToolAlert>}

      {loading && items.length === 0 && <ToolLoadingState title="Lecture des opportunités GSC" description={`Calcul des pages prioritaires pour ${selectedSiteName}.`} rows={6} />}

      {!loading && items.length === 0 && !error && (
        <ToolPanel>
          <ToolEmptyState
            icon={Search}
            title="Aucun plan sauvegardé"
            description="Lance le calcul pour détecter les requêtes proches de la première page et les pages déjà bien classées dont le CTR est faible."
            action={<button type="button" onClick={() => void generate()} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500">Analyser les données GSC</button>}
          />
        </ToolPanel>
      )}

      {items.length > 0 && (
        <>
          <section aria-label="Avancement du plan" className="grid grid-cols-3 gap-3">
            {(["todo", "doing", "done"] as const).map((status) => <div key={status} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="text-2xl font-semibold tabular-nums text-white">{items.filter((item) => item.status === status).length}</div><div className="mt-1 text-xs text-slate-500">{STATUS_LABELS[status]}</div></div>)}
          </section>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
            {(["all", "todo", "doing", "done"] as StatusFilter[]).map((status) => <button key={status} type="button" onClick={() => setStatusFilter(status)} aria-pressed={statusFilter === status} className={`min-h-10 rounded-lg border px-3 text-xs font-medium ${statusFilter === status ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}>{status === "all" ? "Tous" : STATUS_LABELS[status]}</button>)}
          </div>

          <ToolPanel className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <h2 className="font-semibold text-white">Actions prioritaires</h2>
              <CopyKeywordsButton keywords={filtered.map((item) => item.target_keyword)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-slate-950/70 text-left text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">Mot-clé et page</th><th className="px-3 py-3 font-medium">Action</th><th className="px-3 py-3 text-right font-medium">Impressions</th><th className="px-3 py-3 text-right font-medium">Clics</th><th className="px-3 py-3 text-right font-medium">Position</th><th className="px-3 py-3 font-medium">Preuve</th><th className="px-4 py-3 font-medium">Statut</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {filtered.map((item) => (
                    <tr key={item.id} className="align-top hover:bg-slate-800/30">
                      <td className="px-4 py-3"><div className="font-medium text-white">{item.target_keyword}</div>{item.target_url ? <a href={item.target_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-80 items-center gap-1 truncate text-xs text-blue-300 hover:text-blue-200">{item.target_url}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /></a> : <div className="mt-1 text-xs text-slate-500">Page cible non identifiée</div>}</td>
                      <td className="px-3 py-3"><span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-100">{item.action_type ? ACTION_LABELS[item.action_type] : "Vérifier la page"}</span></td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-200">{Number(item.impressions).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-200">{Number(item.clicks).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-cyan-200">{item.position == null ? "—" : Number(item.position).toFixed(1)}</td>
                      <td className="max-w-sm px-3 py-3 text-xs leading-5 text-slate-400">{item.rationale}</td>
                      <td className="px-4 py-3"><select aria-label={`Statut de ${item.target_keyword}`} value={item.status} onChange={(event) => void updateStatus(item.id, event.target.value as ContentItem["status"])} disabled={updatingId === item.id} className="h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white disabled:opacity-50"><option value="todo">À faire</option><option value="doing">En cours</option><option value="done">Terminé</option></select></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ToolPanel>
        </>
      )}
    </ToolPage>
  );
}
