"use client";

import { useCallback, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { DashboardToolNavigation } from "@/components/dashboard/DashboardToolNavigation";
import { dashboardToolForPath } from "@/lib/dashboard-tools";

export function AppWorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileNavigation = useCallback(() => {
    setMobileOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  if (pathname?.startsWith("/login")) return <>{children}</>;
  if (status === "loading") {
    return (
      <div role="status" className="grid min-h-dvh place-items-center bg-slate-950 text-sm text-slate-400">
        Chargement de l&apos;espace SEO…
      </div>
    );
  }
  if (status !== "authenticated") return <>{children}</>;

  const currentTool = dashboardToolForPath(pathname ?? "/dashboard");
  return (
    <div className="min-h-dvh bg-slate-950 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a href="#main-content" className="fixed left-3 top-3 z-[60] -translate-y-24 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0">
        Aller au contenu
      </a>
      <DashboardToolNavigation mobileOpen={mobileOpen} onMobileClose={closeMobileNavigation} />
      <div className="min-w-0">
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-3 backdrop-blur lg:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label="Ouvrir la navigation"
            aria-expanded={mobileOpen}
            aria-controls="mobile-tool-navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{currentTool?.label ?? "SEO Dashboard"}</div>
            <div className="truncate text-xs text-slate-500">{currentTool?.description ?? "Pilotage du portefeuille"}</div>
          </div>
        </div>
        <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
