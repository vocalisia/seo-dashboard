"use client";

import { useEffect } from "react";

function isWalletExtensionNoise(input: unknown): boolean {
  const text = String(input ?? "").toLowerCase();
  return (
    text.includes("keyring is locked") ||
    text.includes("chrome-extension://") ||
    text.includes("injectedscript.bundle.js") ||
    text.includes("owallet")
  );
}

export function DevExtensionErrorGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
      const stack = typeof reason === "object" && reason !== null ? (reason as { stack?: unknown }).stack : "";
      if (isWalletExtensionNoise(message) || isWalletExtensionNoise(stack)) {
        event.preventDefault();
      }
    };

    const onWindowError = (event: ErrorEvent) => {
      if (isWalletExtensionNoise(event.message) || isWalletExtensionNoise(event.filename)) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onWindowError);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onWindowError);
    };
  }, []);

  return null;
}
