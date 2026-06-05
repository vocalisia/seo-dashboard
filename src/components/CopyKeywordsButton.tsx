"use client";

import { useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { Check, Copy } from "lucide-react";

interface CopyKeywordsButtonProps {
  keywords: Array<string | null | undefined>;
  label?: string;
  className?: string;
}

function uniqueKeywords(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const keyword = value?.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function CopyKeywordsButton({
  keywords,
  label = "Copier tous les mots-cles",
  className = "",
}: CopyKeywordsButtonProps) {
  const [copied, setCopied] = useState(false);
  const cleanKeywords = useMemo(() => uniqueKeywords(keywords), [keywords]);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (cleanKeywords.length === 0) return;
    await copyText(cleanKeywords.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={cleanKeywords.length === 0}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-700/80 bg-gray-900/70 text-gray-400 transition-colors hover:border-blue-500/60 hover:bg-blue-500/10 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      title={`${label} (${cleanKeywords.length})`}
      aria-label={`${label} (${cleanKeywords.length})`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
