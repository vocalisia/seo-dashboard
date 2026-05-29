"use client";

/**
 * Sparkline — reusable mini bar chart (pure Tailwind, no SVG dep).
 *
 * Extracted from src/app/tracker/page.tsx so it can be reused on the
 * tracked-keywords table (Google Trends 12-month series).
 *
 * Static class names so Tailwind JIT doesn't purge them.
 */

import React from "react";

interface SparklineProps {
  values: number[];
  color?: "emerald" | "red" | "blue" | "amber";
  inverted?: boolean; // true → lower-is-better (positions)
  height?: number; // px, default 32
  width?: number; // bars width target
}

const COLOR_CLASS: Record<NonNullable<SparklineProps["color"]>, string> = {
  emerald: "bg-emerald-500/60",
  red: "bg-red-500/60",
  blue: "bg-blue-500/60",
  amber: "bg-amber-500/60",
};

export function Sparkline({
  values,
  color = "blue",
  inverted = false,
  height = 32,
}: SparklineProps): React.ReactElement {
  const clean = values.filter((v): v is number => Number.isFinite(v));
  if (clean.length < 2) {
    return <span className="text-gray-600 text-xs">—</span>;
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const barClass = COLOR_CLASS[color];
  const slice = clean.slice(-30);

  return (
    <div className="flex items-end gap-[1px]" style={{ height }}>
      {slice.map((v, i) => {
        const pct = inverted ? 1 - (v - min) / range : (v - min) / range;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-sm ${barClass}`}
            style={{ height: `${Math.max(8, pct * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
