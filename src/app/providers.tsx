"use client";

import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/login")) return <>{children}</>;
  return <SessionProvider>{children}</SessionProvider>;
}
