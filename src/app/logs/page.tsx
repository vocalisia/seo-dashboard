"use client";

import { useRef, useState } from "react";
import { Download, FileSearch, Upload } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  ToolAlert, ToolEmptyState, ToolLoadingState, ToolPage, ToolPanel,
} from "@/components/dashboard/ToolPage";

interface LogEntry {
  date: string;
  ip: string;
  userAgent: string;
  url: string;
  statusCode: number;
  bot: string | null;
}

interface UrlStat {
  url: string;
  total: number;
  google: number;
  ai: number;
}

interface DayBotStat {
  date: string;
  [bot: string]: string | number;
}

const BOT_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "Googlebot", pattern: /googlebot/i },
  { name: "BingBot", pattern: /bingbot/i },
  { name: "YandexBot", pattern: /yandexbot/i },
  { name: "DuckDuckBot", pattern: /duckduckbot/i },
  { name: "AhrefsBot", pattern: /ahrefsbot/i },
  { name: "SemrushBot", pattern: /semrushbot/i },
  { name: "GPTBot", pattern: /gptbot/i },
  { name: "ClaudeBot", pattern: /claudebot/i },
  { name: "PerplexityBot", pattern: /perplexitybot/i },
];

const AI_BOTS = new Set(["GPTBot", "ClaudeBot", "PerplexityBot"]);
const APACHE_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

const BOT_COLORS: Record<string, string> = {
  Googlebot: "#4ade80",
  BingBot: "#60a5fa",
  YandexBot: "#f87171",
  DuckDuckBot: "#fb923c",
  AhrefsBot: "#a78bfa",
  SemrushBot: "#f472b6",
  GPTBot: "#34d399",
  ClaudeBot: "#fbbf24",
  PerplexityBot: "#38bdf8",
};

function detectBot(ua: string): string | null {
  for (const { name, pattern } of BOT_PATTERNS) {
    if (pattern.test(ua)) return name;
  }
  return null;
}

function parseLine(line: string): LogEntry | null {
  // Common Log Format & variants
  const m = line.match(
    /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(?:GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH)\s+(\S+)[^"]*"\s+(\d{3})\s+\S+(?:\s+"[^"]*"\s+"([^"]*)")?/
  );
  if (!m) return null;
  const [, ip, rawDate, url, status, ua = ""] = m;
  const [day = "", month = "", year = ""] = rawDate.split(":", 1)[0].split("/");
  const date = APACHE_MONTHS[month] && /^\d{2}$/.test(day) && /^\d{4}$/.test(year)
    ? `${year}-${APACHE_MONTHS[month]}-${day}`
    : rawDate.slice(0, 11);
  const statusCode = parseInt(status, 10);
  const bot = detectBot(ua);
  return { date, ip, userAgent: ua, url, statusCode, bot };
}

function buildDayStats(entries: LogEntry[]): DayBotStat[] {
  const map = new Map<string, Record<string, number>>();
  for (const e of entries) {
    if (!e.bot) continue;
    if (!map.has(e.date)) map.set(e.date, {});
    const day = map.get(e.date)!;
    day[e.bot] = (day[e.bot] ?? 0) + 1;
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([date, bots]) => ({ date, ...bots }));
}

function buildUrlStats(entries: LogEntry[]): UrlStat[] {
  const map = new Map<string, UrlStat>();
  for (const e of entries) {
    if (!e.bot) continue;
    if (!map.has(e.url)) map.set(e.url, { url: e.url, total: 0, google: 0, ai: 0 });
    const s = map.get(e.url)!;
    s.total += 1;
    if (e.bot === "Googlebot") s.google += 1;
    if (AI_BOTS.has(e.bot)) s.ai += 1;
  }
  return Array.from(map.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

function exportCsv(rows: UrlStat[]) {
  const header = "URL,Total,Googlebot,AI Bots\n";
  const body = rows.map((r) => `"${r.url.replaceAll('"', '""')}",${r.total},${r.google},${r.ai}`).join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = "log-crawl-stats.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function LogsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseReport, setParseReport] = useState<{ total: number; parsed: number; rejected: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    setEntries([]);
    setParseReport(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const parsed = lines.flatMap((l) => {
        const r = parseLine(l);
        return r ? [r] : [];
      });
      setEntries(parsed);
      setParseReport({ total: lines.length, parsed: parsed.length, rejected: lines.length - parsed.length });
      if (lines.length === 0) setError("Le fichier est vide.");
      else if (parsed.length === 0) setError("Aucune ligne reconnue. Formats acceptés : Common/Combined Log Format avec une requête HTTP entre guillemets.");
      setLoading(false);
    };
    reader.onerror = () => {
      setError("Le navigateur n'a pas pu lire ce fichier.");
      setLoading(false);
    };
    reader.readAsText(file);
  }

  const dayStats = buildDayStats(entries);
  const urlStats = buildUrlStats(entries);
  const totalCrawl = entries.filter((e) => e.bot).length;
  const googleCount = entries.filter((e) => e.bot === "Googlebot").length;
  const aiCount = entries.filter((e) => e.bot && AI_BOTS.has(e.bot)).length;
  const activeBots = [...new Set(entries.flatMap((e) => (e.bot ? [e.bot] : [])))];

  return (
    <ToolPage
      title="Analyse des logs de crawl"
      eyebrow="Analyse locale du serveur"
      description="Importe un fichier Common ou Combined Log Format. Le fichier reste dans le navigateur : seules les lignes reconnues sont comptées et le taux de rejet est affiché."
      icon={FileSearch}
    >
      <ToolPanel className="p-4 sm:p-6">
        <button
          type="button"
          className="min-h-32 w-full cursor-pointer rounded-xl border-2 border-dashed border-slate-700 p-6 text-center transition-colors hover:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          <Upload className="mx-auto mb-2 h-8 w-8 text-slate-500" aria-hidden="true" />
          <p className="text-sm text-slate-300">
            {fileName ?? "Glisser un fichier access.log ou cliquer pour choisir"}
          </p>
          <p className="mt-2 text-xs text-slate-500">Formats .log ou .txt · traitement local, aucun envoi réseau</p>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".log,.txt"
          aria-label="Importer un fichier de logs"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </ToolPanel>

      {loading && <ToolLoadingState title="Analyse du fichier" description="Lecture et classification des lignes de crawl." rows={3} />}
      {error && <ToolAlert tone="error">{error}</ToolAlert>}
      {parseReport && !loading && (
        <ToolAlert tone={parseReport.rejected > 0 ? "warning" : "success"}>
          <strong>{parseReport.parsed.toLocaleString("fr-FR")}</strong> ligne(s) reconnue(s) sur {parseReport.total.toLocaleString("fr-FR")}.
          {parseReport.rejected > 0 && <> {parseReport.rejected.toLocaleString("fr-FR")} ligne(s) exclue(s) des statistiques car leur format n&apos;a pas été reconnu.</>}
        </ToolAlert>
      )}
      {!loading && !fileName && (
        <ToolEmptyState icon={FileSearch} title="Aucun fichier analysé" description="Importe un access.log pour mesurer les passages réels de Googlebot et des robots IA." />
      )}

      {entries.length > 0 && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total crawls bots", value: totalCrawl.toLocaleString(), color: "text-cyan-400" },
                {
                  label: "% Googlebot",
                  value: totalCrawl ? `${Math.round((googleCount / totalCrawl) * 100)}%` : "0%",
                  color: "text-green-400",
                },
                {
                  label: "% AI bots",
                  value: totalCrawl ? `${Math.round((aiCount / totalCrawl) * 100)}%` : "0%",
                  color: "text-yellow-400",
                },
                {
                  label: "URLs uniques crawlées",
                  value: new Set(entries.filter((e) => e.bot).map((e) => e.url)).size.toLocaleString(),
                  color: "text-purple-400",
                },
              ].map((c) => (
                <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                  <div className="text-xs text-gray-400 mt-1">{c.label}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            {dayStats.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 mb-4">Crawls/jour par bot (7 derniers jours)</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={dayStats}>
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
                    <Tooltip
                      contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                      labelStyle={{ color: "#e5e7eb" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {activeBots.map((bot) => (
                      <Line
                        key={bot}
                        type="monotone"
                        dataKey={bot}
                        stroke={BOT_COLORS[bot] ?? "#94a3b8"}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-medium text-gray-200">Top 20 URLs crawlées</h2>
                <button
                  type="button"
                  onClick={() => exportCsv(urlStats)}
                  className="flex min-h-11 items-center gap-2 rounded-lg bg-gray-800 px-3 text-xs text-gray-300 hover:text-white"
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 border-b border-gray-800">
                    <tr>
                      <th className="px-5 py-3 text-left">URL</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Googlebot</th>
                      <th className="px-4 py-3 text-right">AI bots</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {urlStats.map((r) => (
                      <tr key={r.url} className="hover:bg-gray-800/50">
                        <td className="px-5 py-2.5 text-gray-300 font-mono text-xs truncate max-w-xs">{r.url}</td>
                        <td className="px-4 py-2.5 text-right text-white font-medium">{r.total}</td>
                        <td className="px-4 py-2.5 text-right text-green-400">{r.google}</td>
                        <td className="px-4 py-2.5 text-right text-yellow-400">{r.ai}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
    </ToolPage>
  );
}
