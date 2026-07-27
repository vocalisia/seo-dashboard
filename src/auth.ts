import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { dashboardCredentialsMatch, getDashboardCredentials } from "@/lib/dashboard-auth";

const isProd = process.env.NODE_ENV === "production";
const nextAuthSecret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
const dashboardCredentials = getDashboardCredentials();

if (isProd && !nextAuthSecret) throw new Error("NEXTAUTH_SECRET is required in production");

const nonProdFallbackSecret = !isProd && !nextAuthSecret
  ? `dev-secret-${globalThis.crypto.randomUUID()}`
  : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: dashboardCredentials ? [
    Credentials({
      id: "credentials",
      name: "SEO Dashboard",
      credentials: {
        username: { label: "Login", type: "text" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (dashboardCredentialsMatch(dashboardCredentials, credentials?.username, credentials?.password)) {
          return { id: "dashboard-admin", name: dashboardCredentials.user };
        }
        return null;
      },
    }),
  ] : [],
  pages: { signIn: "/login" },
  secret: nextAuthSecret ?? nonProdFallbackSecret,
});
