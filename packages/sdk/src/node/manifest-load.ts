/**
 * Loads `manifest.json` from env overrides → cwd walk → GitHub raw → ~/.cache/grid-spawn/manifest.json fallback.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "../manifest-schema";
import { parseJsonObj } from "../parse";
import {
  asyncTryCatch,
  isFileError,
  tryCatch,
  tryCatchIf,
  unwrapOr,
} from "../result";
import { getErrorMessage, isPlainObject } from "../type-guards";
import { getManifestCacheDir, getManifestCacheFile } from "./paths";

export const REPO = "Spectral-Finance/grid-spawn" as const;
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main` as const;
export const VERSION_URL =
  `https://github.com/${REPO}/releases/download/cli-latest/version` as const;

function defaultSpawnCdn(): string {
  return process.env.GRID_SPAWN_CDN ?? "https://spawn.thegrid.ai";
}

/** Primary CDN URL for bootstrap shell scripts (\`{CDN}/{cloud}/{agent}.sh\`). */
export const GRID_SPAWN_CDN = defaultSpawnCdn() as string;

/** @deprecated alias — legacy field naming from upstream manifest slices */
export const SPAWN_CDN = GRID_SPAWN_CDN;

const FETCH_TIMEOUT = 3_000;

let _cached: Manifest | null = null;
let _staleCache = false;

function cacheAge(): number {
  return unwrapOr(
    tryCatchIf(isFileError, () => {
      const st = statSync(getManifestCacheFile());
      return (Date.now() - st.mtimeMs) / 1000;
    }),
    Number.POSITIVE_INFINITY,
  );
}

function logError(message: string, err?: unknown): void {
  console.error(err ? `${message}: ${getErrorMessage(err)}` : message);
}

export function stripDangerousKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripDangerousKeys);
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    clean[key] = stripDangerousKeys(value);
  }
  return clean;
}

function isValidManifest(data: unknown): data is Manifest {
  return (
    isPlainObject(data) &&
    "agents" in data &&
    "clouds" in data &&
    "matrix" in data &&
    isPlainObject(data.agents) &&
    isPlainObject(data.clouds) &&
    isPlainObject(data.matrix)
  );
}

function readCache(): Manifest | null {
  const result = tryCatch(() => {
    const raw = parseJsonObj(readFileSync(getManifestCacheFile(), "utf-8"));
    if (!raw) {
      return null;
    }
    const cleaned = stripDangerousKeys(raw);
    return isValidManifest(cleaned) ? cleaned : null;
  });
  if (!result.ok) {
    logError(`Failed to read cache from ${getManifestCacheFile()}`, result.error);
    return null;
  }
  return result.data;
}

function isTestEnv(): boolean {
  return !!(process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test");
}

function writeCache(data: Manifest): void {
  if (isTestEnv() && !process.env.XDG_CACHE_HOME) {
    return;
  }
  mkdirSync(getManifestCacheDir(), { recursive: true });
  writeFileSync(getManifestCacheFile(), JSON.stringify(data, null, 2), "utf-8");
}

async function fetchManifestFromGitHub(): Promise<Manifest | null> {
  const result = await asyncTryCatch(async () => {
    const res = await fetch(`${RAW_BASE}/manifest.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) {
      logError(`Failed to fetch manifest from GitHub: HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const raw = await res.json();
    const data = stripDangerousKeys(raw);
    if (!isValidManifest(data)) {
      logError("Manifest structure validation failed (agents, clouds, or matrix)");
      return null;
    }
    return data;
  });
  if (!result.ok) {
    logError("Network error fetching manifest", result.error);
    return null;
  }
  return result.data;
}

function updateCache(manifest: Manifest): Manifest {
  writeCache(manifest);
  _cached = manifest;
  _staleCache = false;
  return manifest;
}

/** Walk up from cwd (max 10 dirs) to find repo-root manifest.json */
function findRepoManifestPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "manifest.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** Load and validate manifest.json from a filesystem path (no network). */
function readManifestAt(localPath: string): Manifest | null {
  const result = tryCatch(() => {
    if (!localPath || !existsSync(localPath)) {
      return null;
    }
    const raw = parseJsonObj(readFileSync(localPath, "utf-8"));
    if (!raw) {
      return null;
    }
    const data = stripDangerousKeys(raw);
    return isValidManifest(data) ? data : null;
  });
  return result.ok ? result.data : null;
}

function tryLoadLocalManifest(): Manifest | null {
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
    return null;
  }

  const manifestOverride = process.env.GRID_SPAWN_MANIFEST?.trim();
  if (manifestOverride) {
    const fromManifestEnv = readManifestAt(manifestOverride);
    if (fromManifestEnv) return fromManifestEnv;
  }

  const rootOverride = process.env.GRID_SPAWN_ROOT?.trim();
  if (rootOverride) {
    const fromRoot = readManifestAt(join(rootOverride, "manifest.json"));
    if (fromRoot) return fromRoot;
  }

  const walked = findRepoManifestPath();
  return walked ? readManifestAt(walked) : null;
}

export async function loadManifest(forceRefresh = false): Promise<Manifest> {
  if (_cached && !forceRefresh) {
    return _cached;
  }

  const local = tryLoadLocalManifest();
  if (local) {
    _cached = local;
    _staleCache = false;
    return local;
  }

  const fetched = await fetchManifestFromGitHub();
  if (fetched) {
    return updateCache(fetched);
  }

  const stale = readCache();
  if (stale) {
    _cached = stale;
    _staleCache = true;
    return stale;
  }

  throw new Error(
    "Cannot load manifest: failed to fetch from GitHub and no local cache available.\n\n" +
      "How to fix:\n" +
      "  1. Check your internet connection\n" +
      "  2. Run the UI from this repo or set GRID_SPAWN_ROOT to the checkout (or GRID_SPAWN_MANIFEST to manifest.json)\n" +
      `  3. Clear stale cache and retry:\n     rm -rf ${getManifestCacheDir()}`,
  );
}

export function isStaleCache(): boolean {
  return _staleCache;
}

export function getCacheAge(): number {
  return cacheAge();
}

export function _resetCacheForTesting(): void {
  _cached = null;
  _staleCache = false;
}
