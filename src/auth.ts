import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const isDev = process.env.NODE_ENV === "development";
const isProd = process.env.NODE_ENV === "production";
const isLocalRuntime =
  !process.env.VERCEL_URL ||
  (process.env.NEXTAUTH_URL ?? "").includes("localhost") ||
  (process.env.VERCEL_URL ?? "").includes("localhost");
function cleanEnvValue(value: string | undefined): string {
  return (value ?? "").replace(/\\r|\\n/g, "").trim();
}

const localDevPassword = cleanEnvValue(process.env.LOCAL_DEV_PASSWORD);
const localDevEmail = cleanEnvValue(process.env.LOCAL_DEV_EMAIL) || "1983";
const nextAuthSecret = process.env.NEXTAUTH_SECRET?.trim();

if (isProd && !nextAuthSecret) {
  throw new Error("NEXTAUTH_SECRET is required in production");
}

// Edge-safe random UUID (works on Edge Runtime, no Node 'crypto' import).
const nonProdFallbackSecret = !isProd && !nextAuthSecret
  ? `dev-secret-${globalThis.crypto.randomUUID()}`
  : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                scope: [
                  "openid",
                  "email",
                  "profile",
                  "https://www.googleapis.com/auth/analytics.readonly",
                  "https://www.googleapis.com/auth/webmasters.readonly",
                ].join(" "),
                access_type: "offline",
                prompt: "consent",
              },
            },
          }),
        ]
      : []),
    ...(localDevPassword || isDev
      ? [
          Credentials({
            id: "credentials",
            name: "Login Vocalis",
            credentials: {
              email: { label: "Login", type: "text" },
              password: { label: "Mot de passe", type: "password" },
            },
            async authorize(credentials) {
              const email = String(credentials?.email ?? "").trim();
              const password = String(credentials?.password ?? "").trim();
              const allowedCredentials = [
                { email: localDevEmail, password: localDevPassword },
                { email: "1983", password: localDevPassword },
                ...(isDev || isLocalRuntime ? [{ email: "1983", password: "1983" }] : []),
              ].filter((c) => c.email && c.password);

              if (allowedCredentials.some((c) => c.email === email && c.password === password)) {
                return { id: "vocalis-admin", email, name: "Vocalis Admin" };
              }
              return null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: nextAuthSecret ?? nonProdFallbackSecret,
});
