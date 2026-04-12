import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
