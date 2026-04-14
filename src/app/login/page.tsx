"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BarChart3 } from "lucide-react";

const showDevLogin = process.env.NEXT_PUBLIC_SHOW_DEV_LOGIN === "true";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLocalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/dashboard",
    });
    if (res?.ok) {
      router.push("/dashboard");
    } else {
      setError("Email ou mot de passe incorrect (vérifie LOCAL_DEV_EMAIL / LOCAL_DEV_PASSWORD dans .env.local).");
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

        {showDevLogin && (
          <form onSubmit={handleLocalSubmit} className="space-y-4 mb-8">
            <p className="text-amber-200/90 text-xs font-medium text-center bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
              Mode développement local uniquement (npm run dev)
            </p>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
                placeholder="LOCAL_DEV_PASSWORD"
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50"
            >
              {loading ? "Connexion…" : "Se connecter (local)"}
            </button>
          </form>
        )}

        <div className={showDevLogin ? "border-t border-gray-700 pt-6" : ""}>
          <p className="text-gray-500 text-xs text-center mb-3">
            {showDevLogin ? "Ou avec Google (GA4 + GSC)" : "Connexion avec Google (GA4 + GSC)"}
          </p>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-semibold py-3 px-6 rounded-xl hover:bg-gray-100 transition text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continuer avec Google
          </button>
          {!showDevLogin && (
            <p className="text-gray-500 mt-4 text-center text-xs px-1">
              Connexion locale sans Google : ajoute{" "}
              <code className="text-gray-400">NEXT_PUBLIC_SHOW_DEV_LOGIN=true</code> et{" "}
              <code className="text-gray-400">LOCAL_DEV_PASSWORD</code> dans{" "}
              <code className="text-gray-400">.env.local</code> puis redémarre le serveur.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
