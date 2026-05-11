// shared/paths.ts — Centralized filesystem path resolution for grid-spawn

import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Return the user's home directory, preferring $HOME over os.homedir(). */
export function getUserHome(): string {
  return process.env.HOME || homedir();
}

const CONFIG_SEGMENT = ".config/grid-spawn" as const;

/** Resolve grid-spawn data dir (spawn history lives here). Respects GRID_SPAWN_HOME or legacy SPAWN_HOME. */
export function getSpawnDir(): string {
  const spawnHome = process.env.GRID_SPAWN_HOME || process.env.SPAWN_HOME;
  if (!spawnHome) {
    return join(getUserHome(), CONFIG_SEGMENT);
  }
  if (!isAbsolute(spawnHome)) {
    throw new Error(
      `GRID_SPAWN_HOME must be an absolute path (got "${spawnHome}").\n` +
        "Example: export GRID_SPAWN_HOME=/home/user/.config/grid-spawn",
    );
  }
  const resolved = resolve(spawnHome);
  const userHome = getUserHome();
  if (!resolved.startsWith(userHome + "/") && resolved !== userHome) {
    throw new Error(
      "GRID_SPAWN_HOME must be within your home directory.\n" + `Got: ${resolved}\n` + `Home: ${userHome}`,
    );
  }
  return resolved;
}

/** Path to the spawn history file. */
export function getHistoryPath(): string {
  return join(getSpawnDir(), "history.json");
}

/**
 * Per-cloud credential JSON: ~/.config/grid-spawn/{cloud}.json
 */
export function getSpawnCloudConfigPath(cloud: string): string {
  return join(getUserHome(), CONFIG_SEGMENT, `${cloud}.json`);
}

export function getSpawnPreferencesPath(): string {
  return join(getUserHome(), CONFIG_SEGMENT, "preferences.json");
}

export function getInstallRefPath(): string {
  return join(getUserHome(), CONFIG_SEGMENT, ".ref");
}

export function getInstallIdPath(): string {
  return join(getUserHome(), CONFIG_SEGMENT, ".telemetry-id");
}

/** Legacy cache layout — matches uninstall + older docs; manifests use `~/.cache/grid-spawn` via SDK */
export function getCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(getUserHome(), ".cache"), "grid-spawn");
}

export function getCacheFile(): string {
  return join(getCacheDir(), "manifest.json");
}

export function getUpdateFailedPath(): string {
  return join(getUserHome(), CONFIG_SEGMENT, ".update-failed");
}

export function getUpdateCheckedPath(): string {
  return join(getUserHome(), CONFIG_SEGMENT, ".update-checked");
}

export function getSshDir(): string {
  return join(getUserHome(), ".ssh");
}

export function getTmpDir(): string {
  return tmpdir();
}

export const RC_MARKER_START = "# >>> grid-spawn >>>";
export const RC_MARKER_END = "# <<< grid-spawn <<<";

export const RC_MARKER_LEGACY = "# Added by grid-spawn installer";
