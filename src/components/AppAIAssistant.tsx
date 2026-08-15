"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AIAssistant } from "@/components/AIAssistant";

export function AppAIAssistant() {
  const pathname = usePathname();
  if (pathname?.startsWith("/login")) return null;
  return <AuthenticatedAIAssistant />;
}

function AuthenticatedAIAssistant() {
  const { status } = useSession();

  if (status !== "authenticated") return null;

  return <AIAssistant />;
}
