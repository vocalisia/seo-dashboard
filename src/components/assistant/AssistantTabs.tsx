"use client";

import type { KeyboardEvent } from "react";

export type ActionTab = "write" | "translate" | "image" | "analyze" | "research" | "eeat";

const TABS: ReadonlyArray<{ id: ActionTab; label: string; accessibleLabel: string }> = [
  { id: "eeat", label: "E-E-A-T", accessibleLabel: "E-E-A-T" },
  { id: "write", label: "Rédac", accessibleLabel: "Rédaction" },
  { id: "translate", label: "Trad", accessibleLabel: "Traduction" },
  { id: "image", label: "Image", accessibleLabel: "Image" },
  { id: "analyze", label: "Analyse", accessibleLabel: "Analyse" },
  { id: "research", label: "Recherche", accessibleLabel: "Recherche" },
];

interface AssistantTabsProps {
  activeTab: ActionTab;
  onChange: (tab: ActionTab) => void;
}

function getNextTabIndex(key: string, currentIndex: number) {
  if (key === "Home") return 0;
  if (key === "End") return TABS.length - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % TABS.length;
  if (key === "ArrowLeft") return (currentIndex - 1 + TABS.length) % TABS.length;
  return null;
}

export function AssistantTabs({ activeTab, onChange }: AssistantTabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = getNextTabIndex(event.key, currentIndex);
    if (nextIndex === null) return;

    event.preventDefault();
    onChange(TABS[nextIndex].id);
    const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]'
    );
    tabButtons?.[nextIndex]?.focus();
  };

  return (
    <div
      className="flex overflow-x-auto border-b border-gray-800"
      role="tablist"
      aria-label="Actions de l'assistant"
      aria-orientation="horizontal"
    >
      {TABS.map((tab, index) => {
        const selected = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`ai-tab-${tab.id}`}
            aria-label={tab.accessibleLabel}
            aria-selected={selected}
            aria-controls="ai-assistant-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`min-h-11 min-w-11 flex-1 whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${
              selected
                ? "border-b-2 border-blue-500 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
