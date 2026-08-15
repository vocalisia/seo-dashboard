"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, AlarmClockCheck, BarChart3, Bell, Bot, Boxes, Braces,
  CalendarDays, ChartColumn, ChartNoAxesCombined, ClipboardCheck,
  Crosshair, DatabaseZap, Earth, FileChartColumn, Gauge, GitBranch,
  HeartPulse, LayoutDashboard, Lightbulb, Link2, ListFilter,
  LucideIcon, Map, MessageSquareText, Network, NotepadText, Orbit, Radar,
  RefreshCw, ScanSearch, ScanText, Scale, ScrollText, Search, SearchCheck,
  ShieldCheck, Sparkles, Split, Tags, Target, TimerReset, TrendingUp,
  Upload, UsersRound, Video, X,
} from "lucide-react";
import {
  DASHBOARD_TOOL_GROUPS,
  DASHBOARD_TOOLS,
  dashboardToolForPath,
  type DashboardToolGroupId,
  type DashboardToolIcon,
} from "@/lib/dashboard-tools";

const ICONS: Record<DashboardToolIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  overview: Gauge,
  positions: Radar,
  tracker: TrendingUp,
  control: ShieldCheck,
  reports: FileChartColumn,
  weekly: AlarmClockCheck,
  alerts: Bell,
  calendar: CalendarDays,
  refresh: RefreshCw,
  opportunities: Lightbulb,
  competitors: UsersRound,
  scanner: ScanSearch,
  keywords: Tags,
  tracked: ListFilter,
  countries: Earth,
  compare: Scale,
  striking: Crosshair,
  backlinks: Link2,
  authority: ClipboardCheck,
  audit: SearchCheck,
  health: HeartPulse,
  links: Network,
  pagerank: GitBranch,
  schema: Braces,
  index: DatabaseZap,
  cannibal: Split,
  crossDomain: Orbit,
  ctr: Target,
  decay: TimerReset,
  autopilot: Bot,
  roi: ChartNoAxesCombined,
  contentPlan: NotepadText,
  clusters: Boxes,
  aiVisibility: Sparkles,
  aiPrompts: MessageSquareText,
  aio: ScanText,
  youtube: Video,
  import: Upload,
  ga4: ChartColumn,
  traffic: Map,
  logs: ScrollText,
};

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

interface DashboardToolNavigationProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function DashboardToolNavigation({ mobileOpen, onMobileClose }: DashboardToolNavigationProps) {
  const pathname = usePathname();
  const currentTool = dashboardToolForPath(pathname ?? "/dashboard");
  const currentGroup = currentTool?.group;
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<DashboardToolGroupId>>(
    new Set([currentGroup ?? "pilotage"]),
  );
  const mobilePanelRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onMobileClose();
        return;
      }
      if (event.key !== "Tab" || !mobilePanelRef.current) return;
      const focusable = Array.from(mobilePanelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => mobileCloseRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previousActive?.focus();
    };
  }, [mobileOpen, onMobileClose]);

  const visibleTools = useMemo(() => {
    const needle = normalized(query);
    if (!needle) return DASHBOARD_TOOLS;
    return DASHBOARD_TOOLS.filter((tool) => normalized([
      tool.label,
      tool.description,
      ...(tool.keywords ?? []),
    ].join(" ")).includes(needle));
  }, [query]);

  const toggleGroup = (groupId: DashboardToolGroupId) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const panel = (mobile: boolean) => (
    <div className="flex h-full min-h-0 flex-col bg-slate-950">
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" onClick={mobile ? onMobileClose : undefined} className="flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-950/50">
              <BarChart3 className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span id={mobile ? "mobile-tool-navigation-title" : undefined} className="block text-sm font-semibold text-white">SEO Dashboard</span>
              <span className="block text-xs text-slate-400">Pilotage SEO unifié</span>
            </span>
          </Link>
          {mobile && (
            <button ref={mobileCloseRef} type="button" onClick={onMobileClose} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label="Fermer la navigation">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <label className="relative mt-4 block">
          <span className="sr-only">Rechercher un outil</span>
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un outil"
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-900 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
          />
        </label>
      </div>

      <nav aria-label="Outils SEO" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {DASHBOARD_TOOL_GROUPS.map((group) => {
          const tools = visibleTools.filter((tool) => tool.group === group.id);
          if (tools.length === 0) return null;
          const expanded = Boolean(query.trim()) || openGroups.has(group.id) || currentGroup === group.id;
          return (
            <section key={group.id} className="mb-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={expanded}
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 hover:bg-slate-900 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <span>{group.label}</span>
                <span className="text-[10px] text-slate-600">{tools.length}</span>
              </button>
              {expanded && (
                <div className="mt-1 space-y-1">
                  {tools.map((tool) => {
                    const Icon = ICONS[tool.icon];
                    const active = pathname === tool.href || (tool.href !== "/dashboard" && pathname?.startsWith(`${tool.href}/`));
                    return (
                      <Link
                        key={tool.href}
                        href={tool.href}
                        onClick={mobile ? onMobileClose : undefined}
                        aria-current={active ? "page" : undefined}
                        title={tool.description}
                        className={`group flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                          active
                            ? "border-blue-500/40 bg-blue-500/15 text-white"
                            : "border-transparent text-slate-300 hover:border-slate-800 hover:bg-slate-900 hover:text-white"
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-blue-300" : "text-slate-500 group-hover:text-slate-300"}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {visibleTools.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-400">
            Aucun outil ne correspond à cette recherche.
          </div>
        )}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-400">
          <Activity className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          <span>Sources affichées avec leur provenance</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh border-r border-slate-800 lg:block" aria-label="Navigation principale">
        {panel(false)}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/65" onMouseDown={onMobileClose} aria-hidden="true" />
          <aside
            ref={mobilePanelRef}
            id="mobile-tool-navigation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-tool-navigation-title"
            className="relative h-dvh w-[min(88vw,21rem)] border-r border-slate-700 shadow-2xl"
          >
            {panel(true)}
          </aside>
        </div>
      )}
    </>
  );
}
