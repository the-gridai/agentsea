// node/cdn.ts — Resolve the CDN origin agentsea fetches scripts + one-liners from.
//
// This is the single source of truth for CDN origin resolution, shared by the
// SDK (manifest/script URLs) and the CLI (install/update/script one-liners), so
// the two can never drift onto different hosts again.
//
// It lets one binary serve every environment (dev / staging / prod) without a
// per-environment build:
//
//   1. AGENTSEA_CDN env var ............ explicit runtime override (highest)
//   2. ~/.config/agentsea/cdn-origin ... pinned by install.sh to the origin the
//      CLI was installed from. Each environment serves an install.sh with its own
//      origin baked in (injected at deploy time by packages/ui/scripts/sync-cdn-public.sh
//      from NEXT_PUBLIC_AGENTSEA_PUBLIC_ORIGIN), and the installer persists it here —
//      so a CLI installed from agentsea.dev.thegrid.ai keeps fetching from dev,
//      agentsea.staging.thegrid.ai from staging, agentsea.thegrid.ai from prod, etc.
//   3. AGENTSEA_DEFAULT_CDN ............. built-in fallback (lowest)

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentseaConfigDir } from "./paths";

/**
 * Last-resort origin when neither AGENTSEA_CDN nor an install-time pin is set
 * (e.g. running from source). Points at the dev deployment, which is always
 * live; real installs pin their own environment via cdn-origin.
 */
export const AGENTSEA_DEFAULT_CDN = "https://agentsea.dev.thegrid.ai";

/** File under the agentsea config dir where install.sh pins the install origin. */
export const CDN_ORIGIN_FILE = "cdn-origin";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readPinnedOrigin(): string | undefined {
  try {
    const raw = readFileSync(join(getAgentseaConfigDir(), CDN_ORIGIN_FILE), "utf8").trim();
    return /^https?:\/\/\S+$/.test(raw) ? stripTrailingSlash(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Origin (scheme + host, no trailing slash) the CLI fetches CDN assets from:
 * the per-cloud agent script (`{origin}/{cloud}/{agent}.sh`), the GitHub-auth and
 * sprite helper one-liners, and the install/update commands shown to the user.
 */
export function getCdnOrigin(): string {
  const fromEnv = process.env.AGENTSEA_CDN?.trim();
  if (fromEnv) {
    return stripTrailingSlash(fromEnv);
  }
  const pinned = readPinnedOrigin();
  if (pinned) {
    return pinned;
  }
  return AGENTSEA_DEFAULT_CDN;
}
