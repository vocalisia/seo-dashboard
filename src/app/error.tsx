"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard render error", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-red-900/60 bg-gray-900 p-6 shadow-xl">
        <div className="flex items-center gap-3 text-red-300">
          <AlertTriangle className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Le dashboard a rencontre une erreur.</h1>
        </div>
        <p className="mt-3 text-sm text-gray-300">
          L&apos;interface reste disponible. Relance la page ou reviens au dashboard.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            <RefreshCw className="h-4 w-4" />
            Reessayer
          </button>
          <a
            href="/dashboard"
            className="rounded border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
          >
            Retour dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
