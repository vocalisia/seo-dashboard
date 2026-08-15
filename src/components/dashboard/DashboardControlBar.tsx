"use client";

import Link from "next/link";
import { Database, Globe2, Loader2, Radar, RefreshCw, Search } from "lucide-react";

export type DashboardPeriod = "3" | "7" | "30" | "90";

interface DashboardControlBarProps {
  siteCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  country: string;
  onCountryChange: (country: string) => void;
  syncing: boolean;
  onSync: () => void;
}

const COUNTRIES = [
  { value: "", label: "Tous les marchés" },
  { value: "ch", label: "Suisse" },
  { value: "fr", label: "France" },
  { value: "en", label: "Royaume-Uni / États-Unis" },
  { value: "de", label: "Allemagne / Autriche / Suisse" },
  { value: "es", label: "Espagne" },
  { value: "it", label: "Italie" },
  { value: "nl", label: "Pays-Bas" },
  { value: "pt", label: "Portugal / Brésil" },
];

export function DashboardControlBar(props: DashboardControlBarProps) {
  return (
    <header className="border-b border-slate-800 bg-slate-950 px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Cockpit SEO</h1>
            <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-200">
              {props.siteCount} domaines actifs
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">Positions GSC, volumes importés et actions prioritaires du portefeuille.</p>
        </div>

        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <label className="relative block min-w-0 xl:w-56">
            <span className="sr-only">Filtrer les mots-clés affichés</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              placeholder="Filtrer les mots-clés"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              className="h-11 w-full rounded-lg border border-slate-700 bg-slate-900 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
            />
          </label>

          <div className="grid h-11 grid-cols-4 overflow-hidden rounded-lg border border-slate-700 bg-slate-900" aria-label="Période GSC">
            {(["3", "7", "30", "90"] as DashboardPeriod[]).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => props.onPeriodChange(period)}
                aria-pressed={props.period === period}
                className={`min-w-11 px-2 text-sm font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  props.period === period ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {period} j
              </button>
            ))}
          </div>

          <label className="relative block xl:w-52">
            <span className="sr-only">Marché</span>
            <Globe2 className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" />
            <select
              value={props.country}
              onChange={(event) => props.onCountryChange(event.target.value)}
              className="h-11 w-full appearance-none rounded-lg border border-slate-700 bg-slate-900 pl-9 pr-8 text-sm text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              aria-label="Filtrer par marché"
            >
              {COUNTRIES.map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Link href="/positions" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
              <Radar className="h-4 w-4" aria-hidden="true" />
              Positions
            </Link>
            <Link href="/keyword-planner-import" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              <Database className="h-4 w-4" aria-hidden="true" />
              Volumes
            </Link>
          </div>

          <button
            type="button"
            onClick={props.onSync}
            disabled={props.syncing}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-950/30 hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            {props.syncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {props.syncing ? "Synchronisation…" : "Synchroniser"}
          </button>
        </div>
      </div>
    </header>
  );
}
