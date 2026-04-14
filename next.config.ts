import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Si un package-lock.json existe plus haut (ex. C:\Users\cohen.000), Next 15+ peut
// inférer une mauvaise racine → Turbopack sert des chunks incorrects (page blanche).
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  images: {
    remotePatterns: [
      // OpenAI DALL-E 3 CDN
      { protocol: "https", hostname: "oaidalleapiprodscus.blob.core.windows.net" },
      { protocol: "https", hostname: "*.openai.com" },
      // Gemini / Google image CDN
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "*.google.com" },
      // Generic fallback
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
