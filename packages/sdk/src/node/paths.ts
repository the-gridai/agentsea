import { homedir } from "node:os";
import { join } from "node:path";

export function getUserHome(): string {
  return process.env.HOME || homedir();
}

/** Disk cache for downloaded manifest (XDG). */
export function getManifestCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(getUserHome(), ".cache"), "grid-spawn");
}

export function getManifestCacheFile(): string {
  return join(getManifestCacheDir(), "manifest.json");
}
