import type { MetadataRoute } from "next";

const PUBLIC_ORIGIN = "https://agentsea.thegrid.ai";

export default function robots(): MetadataRoute.Robots {
  const allowedBots = [
    "*",
    "Googlebot",
    "Bingbot",
    "Applebot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "ExaSearchBot",
    "ShapBot",
    "FirecrawlAgent",
  ];

  return {
    rules: allowedBots.map((userAgent) => ({ userAgent, allow: "/" })),
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
    host: PUBLIC_ORIGIN,
  };
}
