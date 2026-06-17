import { join } from "path";
import type { NextConfig } from "next";

// Keep `next dev` output separate from `next build` / `next start`. Sharing the same
// `distDir` (especially running dev + build concurrently) causes HTML/asset URL skew
// and 404s on /_next/static/* (missing CSS/chunks).
const distDir = process.argv[2] === "dev" ? ".next-dev" : ".next";

const repoRoot = join(__dirname, "../../");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir,
  // Pin the repo root so Next does not climb into a parent workspace.
  outputFileTracingRoot: repoRoot,
  experimental: {
    optimizePackageImports: ["@tanstack/react-query"],
  },
  sassOptions: {
    silenceDeprecations: ["legacy-js-api", "import", "slash-div", "global-builtin"],
  },
  // Allow importing from sibling workspace packages without transpilation issues.
  transpilePackages: ["@agentsea/sdk"],
  // Webpack’s filesystem pack cache can reference missing chunks after interrupted
  // compiles; use in-memory cache in dev so routes don’t 404 while files are still compiling.
  webpack: (config, { dev }) => {
    // Avoid persisted webpack pack cache clobber between concurrent dev/build, but
    // keep in-memory caching so middleware serves CSS chunks as soon as they compile.
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },

  /** Legacy URLs */
  async redirects() {
    return [
      { source: "/login", destination: "/cli", permanent: false },
      { source: "/spawns", destination: "/cli", permanent: false },
      { source: "/spawns/:path*", destination: "/cli", permanent: false },
      { source: "/workspaces", destination: "/", permanent: false },
      { source: "/settings", destination: "/cli", permanent: false },
      { source: "/billing", destination: "/", permanent: false },
      { source: "/recipes", destination: "/", permanent: false },
      { source: "/webhooks", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
