"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AIAssistant } from "@/components/AIAssistant";

export function AppAIAssistant() {
  const pathname = usePathname();
  const { status } = useSession();

  if (pathname?.startsWith("/login")) return null;
  if (status !== "authenticated") return null;

  return <AIAssistant />;
}
