import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const isDev = process.env.NODE_ENV === "development";
const localDevPassword = process.env.LOCAL_DEV_PASSWORD?.trim();
const localDevEmail = (process.env.LOCAL_DEV_EMAIL ?? "admin@localhost").trim();

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
    ...(isDev && localDevPassword
      ? [
          Credentials({
            id: "credentials",
            name: "Local",
            credentials: {
              email: { label: "Email", type: "email" },
              password: { label: "Mot de passe", type: "password" },
            },
            async authorize(credentials) {
              if (
                credentials?.email === localDevEmail &&
                credentials?.password === localDevPassword
              ) {
                return { id: "local-dev", email: localDevEmail, name: "Dev local" };
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
  secret: process.env.NEXTAUTH_SECRET ?? "seo-dashboard-secret-2026",
});
