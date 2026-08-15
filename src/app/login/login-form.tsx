"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";

type Props = {
  credentialsEnabled: boolean;
};

export function safeDashboardCallback(rawValue: string | null): string {
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) return "/dashboard";
  try {
    const url = new URL(rawValue, "https://dashboard.local");
    if (url.origin !== "https://dashboard.local" || url.pathname.startsWith("/login")) return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}

export function LoginForm({ credentialsEnabled }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const callbackUrl = safeDashboardCallback(new URLSearchParams(window.location.search).get("callbackUrl"));
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });
    if (res?.ok) {
      router.push(callbackUrl);
    } else {
      setError("Login ou mot de passe incorrect.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="bg-blue-500/10 p-4 rounded-2xl">
            <BarChart3 className="w-10 h-10 text-blue-400" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2 text-center">SEO Dashboard</h1>
        <p className="text-gray-400 mb-6 text-center text-sm">Connexion</p>

        {credentialsEnabled ? (
          <form onSubmit={handleSubmit} className="space-y-4 mb-8">
            <div>
              <label htmlFor="dashboard-username" className="block text-sm text-gray-400 mb-1">Login</label>
              <input
                id="dashboard-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
                autoComplete="username"
                placeholder="Identifiant"
              />
            </div>
            <div>
              <label htmlFor="dashboard-password" className="block text-sm text-gray-400 mb-1">Mot de passe</label>
              <input
                id="dashboard-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
                placeholder="Mot de passe"
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50"
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        ) : (
          <p className="text-gray-500 text-center text-sm">
            Connexion indisponible. Configure les variables d&apos;accès du dashboard.
          </p>
        )}
      </div>
    </div>
  );
}
