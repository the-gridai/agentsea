import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getUserHome(): string {
  return process.env.HOME || homedir();
}

/**
 * Config dir where install.sh pins the CDN origin (`cdn-origin`) and the CLI
 * stores its state. Honors AGENTSEA_HOME so it stays in sync with the CLI's
 * own path resolution. Defaults to ~/.config/agentsea.
 */
export function getAgentseaConfigDir(): string {
  const agentseaHome = process.env.AGENTSEA_HOME?.trim();
  if (agentseaHome) {
    return agentseaHome;
  }
  return join(getUserHome(), ".config", "agentsea");
}

/** Disk cache for downloaded manifest (XDG). Prefers agentsea with legacy agentsea fallback. */
export function getManifestCacheDir(): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(getUserHome(), ".cache");
  const newDir = join(cacheRoot, "agentsea");
  const oldDir = join(cacheRoot, "agentsea");
  if (!existsSync(newDir) && existsSync(oldDir)) {
    return oldDir;
  }
  return newDir;
}

export function getManifestCacheFile(): string {
  return join(getManifestCacheDir(), "manifest.json");
}
